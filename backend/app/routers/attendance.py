"""
Attendance router — cross-verification + aggregation + delta close + correction.

operationIds: verifyAttendance, getSessionAttendance, batchCloseAttendance,
correctAttendance.

verifyAttendance runs the 5-step server verification in order:
  (1) auth window open        -> window_closed
  (2) QR x audio cross-verify -> cross_verify_failed
  (3) single-use nonce        -> nonce_reused
  (4) device_uuid matches     -> device_mismatch
  (5) uniqueness (acct+device)-> duplicate_attendance
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser, get_current_user, require_professor
from app.models import Attendance, Course, Device, Session
from app.redis_client import get_redis
from app.schemas import (
    AttendanceAggregate,
    AttendanceRecord,
    AttendanceStatus,
    BatchCloseRequest,
    CorrectAttendanceRequest,
    MyAttendanceItem,
    VerifyReason,
    VerifyRequest,
    VerifyResult,
    VerifyStatus,
)
from app.services.aggregate import absence_count, build_aggregate, risk_warning_for
from app.services.ownership import load_owned_session
from app.services.tokens import consume_nonce, cross_verify
from app.timeutil import as_aware, now as _now

router = APIRouter(tags=["attendance"])

logger = logging.getLogger("syncattend.attendance")


def _rejected(reason: VerifyReason, *, cross=False, device=False) -> VerifyResult:
    return VerifyResult(
        status=VerifyStatus.rejected,
        cross_verified=cross,
        device_matched=device,
        reason=reason,
    )


@router.post(
    "/attendance/verify", response_model=VerifyResult, operation_id="verifyAttendance"
)
async def verify_attendance(
    body: VerifyRequest,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerifyResult:
    redis = get_redis()

    # Diagnostic breadcrumb: a common client bug is calling verify with a blank
    # or wrong session_id (e.g. QR payload missing session_id). Logging it lets
    # us trace that from server logs. session_id is not sensitive.
    logger.info(
        "verifyAttendance user=%s session_id=%r%s",
        user.id,
        body.session_id,
        " (EMPTY)" if not body.session_id else "",
    )

    session = (
        await db.execute(select(Session).where(Session.id == body.session_id))
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")

    # (1) auth window open
    window_open = session.status == "open" and as_aware(session.window_expires_at) > _now()
    if not window_open:
        response.status_code = status.HTTP_409_CONFLICT
        return _rejected(VerifyReason.window_closed)

    # (2) QR x audio cross-verify (issued together, both unexpired)
    if not await cross_verify(redis, body.session_id, body.qr_token, body.audio_nonce):
        response.status_code = status.HTTP_409_CONFLICT
        return _rejected(VerifyReason.cross_verify_failed)

    # (3) single-use nonce (consume atomically; second attempt fails)
    if not await consume_nonce(redis, body.session_id, body.qr_token):
        response.status_code = status.HTTP_409_CONFLICT
        return _rejected(VerifyReason.nonce_reused, cross=True)

    # (4) device_uuid matches the account's active binding
    binding = (
        await db.execute(
            select(Device).where(Device.user_id == user.id, Device.is_active.is_(True))
        )
    ).scalar_one_or_none()
    if binding is None or binding.device_uuid != body.device_uuid:
        response.status_code = status.HTTP_409_CONFLICT
        return _rejected(VerifyReason.device_mismatch, cross=True)

    # (5) uniqueness: one attendance per (session, student) AND per (session, device)
    dup = (
        await db.execute(
            select(Attendance).where(
                Attendance.session_id == body.session_id,
                (Attendance.student_id == user.id)
                | (Attendance.device_uuid == body.device_uuid),
            )
        )
    ).scalar_one_or_none()
    if dup is not None:
        response.status_code = status.HTTP_409_CONFLICT
        return _rejected(VerifyReason.duplicate_attendance, cross=True, device=True)

    record = Attendance(
        session_id=body.session_id,
        student_id=user.id,
        device_uuid=body.device_uuid,
        status="present",
        verified_at=_now(),
    )
    db.add(record)
    try:
        await db.commit()
    except IntegrityError:
        # race: uniqueness enforced at DB level
        await db.rollback()
        response.status_code = status.HTTP_409_CONFLICT
        return _rejected(VerifyReason.duplicate_attendance, cross=True, device=True)

    absences = await absence_count(db, user.id)
    return VerifyResult(
        status=VerifyStatus.present,
        cross_verified=True,
        device_matched=True,
        reason=None,
        risk_warning=risk_warning_for(absences),
    )


@router.get(
    "/me/attendance",
    response_model=list[MyAttendanceItem],
    operation_id="getMyAttendance",
)
async def get_my_attendance(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MyAttendanceItem]:
    """
    The authenticated student's own attendance history, newest first, with
    course context so the mobile app can render real rows (no placeholder).
    Each row is one attendance record joined to its session and course.
    """
    rows = (
        await db.execute(
            select(Attendance, Session, Course)
            .join(Session, Attendance.session_id == Session.id)
            .join(Course, Session.course_id == Course.id)
            .where(Attendance.student_id == user.id)
            .order_by(Session.window_opened_at.desc())
        )
    ).all()
    return [
        MyAttendanceItem(
            record_id=att.id,
            session_id=att.session_id,
            course_id=course.id,
            course_name=course.name,
            status=AttendanceStatus(att.status),
            verified_at=att.verified_at,
            session_opened_at=sess.window_opened_at,
        )
        for att, sess, course in rows
    ]


async def _load_owned_session(db: AsyncSession, session_id: str, professor_id: str) -> Session:
    return await load_owned_session(db, session_id, professor_id)


@router.get(
    "/sessions/{id}/attendance",
    response_model=AttendanceAggregate,
    operation_id="getSessionAttendance",
)
async def get_session_attendance(
    id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> AttendanceAggregate:
    await _load_owned_session(db, id, prof.id)
    return await build_aggregate(db, id)


@router.post(
    "/sessions/{id}/attendance/batch",
    response_model=AttendanceAggregate,
    operation_id="batchCloseAttendance",
)
async def batch_close_attendance(
    id: str,
    body: BatchCloseRequest,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> AttendanceAggregate:
    """Delta close: only apply changed/unverified records (absent by default)."""
    await _load_owned_session(db, id, prof.id)
    for delta in body.deltas:
        existing = (
            await db.execute(
                select(Attendance).where(
                    Attendance.session_id == id,
                    Attendance.student_id == delta.student_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                Attendance(
                    session_id=id,
                    student_id=delta.student_id,
                    device_uuid=f"delta:{delta.student_id}",  # placeholder for non-verified
                    status=delta.status.value,
                    corrected_by=prof.id,
                )
            )
        elif existing.status != delta.status.value:
            existing.status = delta.status.value
            existing.corrected_by = prof.id
    await db.commit()
    return await build_aggregate(db, id)


@router.patch(
    "/attendance/{record_id}",
    response_model=AttendanceRecord,
    operation_id="correctAttendance",
)
async def correct_attendance(
    record_id: str,
    body: CorrectAttendanceRequest,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> AttendanceRecord:
    record = (
        await db.execute(select(Attendance).where(Attendance.id == record_id))
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="record not found")
    await _load_owned_session(db, record.session_id, prof.id)
    record.status = body.status.value
    record.corrected_by = prof.id
    await db.commit()
    await db.refresh(record)
    return AttendanceRecord(
        record_id=record.id,
        session_id=record.session_id,
        student_id=record.student_id,
        status=AttendanceStatus(record.status),
        verified_at=record.verified_at,
    )
