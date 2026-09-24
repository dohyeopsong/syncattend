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

from datetime import datetime, timezone

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
    VerifyReason,
    VerifyRequest,
    VerifyResult,
    VerifyStatus,
)
from app.services.aggregate import absence_count, build_aggregate, risk_warning_for
from app.services.tokens import consume_nonce, cross_verify

router = APIRouter(tags=["attendance"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


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

    session = (
        await db.execute(select(Session).where(Session.id == body.session_id))
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")

    # (1) auth window open
    window_open = session.status == "open" and _as_aware(session.window_expires_at) > _now()
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


async def _load_owned_session(db: AsyncSession, session_id: str, professor_id: str) -> Session:
    session = (
        await db.execute(select(Session).where(Session.id == session_id))
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    course = (
        await db.execute(select(Course).where(Course.id == session.course_id))
    ).scalar_one_or_none()
    if course is None or course.professor_id != professor_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your session")
    return session


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
