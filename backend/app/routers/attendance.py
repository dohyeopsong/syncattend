"""
Attendance router — cross-verification + aggregation + delta close + correction.

operationIds: verifyAttendance, getSessionAttendance, batchCloseAttendance,
correctAttendance.

verifyAttendance runs the 4-step server verification in order:
  (1) auth window open        -> window_closed
  (2) QR x audio cross-verify -> cross_verify_failed
  (3) device_uuid matches     -> device_mismatch
  (4) uniqueness (acct+device)-> duplicate_attendance
"""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser, get_current_user, require_professor
from app.models import Attendance, Course, Enrollment, Session, User
from app.schemas import (
    AttendanceAggregate,
    AttendanceRecord,
    AttendanceStatus,
    BatchCloseRequest,
    CorrectAttendanceRequest,
    MyAttendanceItem,
    VerifyRequest,
    VerifyResult,
)
from app.services.aggregate import build_aggregate
from app.services.ownership import load_owned_session
from app.services.verify import run_verification

router = APIRouter(tags=["attendance"])

logger = logging.getLogger("syncattend.attendance")


@router.post(
    "/attendance/verify", response_model=VerifyResult, operation_id="verifyAttendance"
)
async def verify_attendance(
    body: VerifyRequest,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerifyResult:
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

    outcome = await run_verification(
        db,
        session=session,
        student_id=user.id,
        device_uuid=body.device_uuid,
        qr_token=body.qr_token,
        audio_nonce=body.audio_nonce,
    )
    if outcome.rejected:
        response.status_code = status.HTTP_409_CONFLICT
    return outcome.result


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
            week_number=sess.week_number,
            status=AttendanceStatus(att.status),
            check_in_verified_at=att.check_in_verified_at,
            check_out_verified_at=att.check_out_verified_at,
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


@router.get(
    "/sessions/{id}/attendance/export",
    operation_id="exportSessionAttendance",
)
async def export_session_attendance(
    id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Export a session's full attendance roster as a downloadable JSON file.

    Returns every enrolled student with their final status (present/absent/
    pending), verified_at, and correction info, plus session/course context and
    the date. Suitable for archival / later JSON extraction.
    """
    session = await _load_owned_session(db, id, prof.id)

    # Enrolled students for this course.
    enrolled = (
        await db.execute(
            select(Enrollment.student_id, User.name, User.student_id).join(
                User, Enrollment.student_id == User.id
            ).where(Enrollment.course_id == session.course_id)
        )
    ).all()

    # All attendance records for this session.
    records = (
        await db.execute(
            select(Attendance).where(Attendance.session_id == id)
        )
    ).scalars().all()
    rec_by_student = {r.student_id: r for r in records}

    rows = []
    for sid, name, school_student_id in enrolled:
        r = rec_by_student.get(sid)
        rows.append({
            "student_id": school_student_id or sid,
            "name": name,
            "status": r.status if r else "pending",
            "check_in_verified_at": (
                r.check_in_verified_at.isoformat()
                if r and r.check_in_verified_at else None
            ),
            "check_out_verified_at": (
                r.check_out_verified_at.isoformat()
                if r and r.check_out_verified_at else None
            ),
            "corrected_by": r.corrected_by if r else None,
        })

    course = (
        await db.execute(select(Course).where(Course.id == session.course_id))
    ).scalar_one_or_none()

    payload = {
        "session_id": session.id,
        "course_id": session.course_id,
        "course_name": course.name if course else None,
        "course_code": course.code if course else None,
        "week_number": session.week_number,
        "date": session.window_opened_at.isoformat() if session.window_opened_at else None,
        "total": len(rows),
        "present": sum(1 for r in rows if r["status"] == "present"),
        "absent": sum(1 for r in rows if r["status"] == "absent"),
        "late": sum(1 for r in rows if r["status"] == "late"),
        "early_leave": sum(1 for r in rows if r["status"] == "early_leave"),
        "pending": sum(1 for r in rows if r["status"] == "pending"),
        "students": rows,
    }

    import json
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    fname = f"attendance_{session.id[:8]}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


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
    """Delta close: apply explicit corrections, then derive the final status of
    every enrolled student from their check_in/check_out timestamps. After a
    close, the session has zero pending records — every student is resolved to
    present / late / early_leave / absent."""
    session = await _load_owned_session(db, id, prof.id)
    # A close finalises the session: ensure phase=closed so the live aggregate
    # switches to showing resolved statuses.
    session.phase = "closed"
    # 1. Apply explicit deltas (professor-in-the-loop corrections).
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
    # 2. Auto-derive: every enrolled student whose status is still pending gets
    #    a final status from the two timestamps. No record at all → absent.
    #    This is the "no pending after close" policy — 미인증/대기 학생은 마감
    #    시 타임스탬프 기준으로 확정된다.
    enrolled = (
        (
            await db.execute(
                select(Enrollment.student_id).where(
                    Enrollment.course_id == session.course_id
                )
            )
        )
        .scalars()
        .all()
    )
    records = (
        (
            await db.execute(
                select(Attendance).where(Attendance.session_id == id)
            )
        )
        .scalars()
        .all()
    )
    rec_by_student = {r.student_id: r for r in records}
    for sid in enrolled:
        r = rec_by_student.get(sid)
        if r is None:
            # No record at all → create an absent one.
            db.add(
                Attendance(
                    session_id=id,
                    student_id=sid,
                    device_uuid=f"delta:{sid}",
                    status="absent",
                    corrected_by=prof.id,
                )
            )
        elif r.status == "pending":
            if r.check_in_verified_at and r.check_out_verified_at:
                r.status = "present"
            elif r.check_in_verified_at and not r.check_out_verified_at:
                r.status = "early_leave"
            elif r.check_out_verified_at and not r.check_in_verified_at:
                r.status = "late"
            else:
                r.status = "absent"
            r.corrected_by = prof.id
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
        check_in_verified_at=record.check_in_verified_at,
        check_out_verified_at=record.check_out_verified_at,
    )
