"""
Attendance verification logic — extracted so the real /attendance/verify
endpoint and the simulation endpoint share ONE code path.

The 4-step server verification (in order):
  (1) auth window open        -> window_closed
  (2) QR x audio cross-verify -> cross_verify_failed
  (3) device_uuid matches     -> device_mismatch
  (4) uniqueness (acct+device)-> duplicate_attendance

Returns a VerifyResult; the caller sets the HTTP status (409 on rejection).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Attendance, Device, Session
from app.redis_client import get_redis
from app.schemas import VerifyReason, VerifyResult, VerifyStatus
from app.services.aggregate import absence_count, risk_warning_for
from app.services.tokens import cross_verify
from app.timeutil import as_aware, now as _now


@dataclass
class VerifyOutcome:
    """Result of one verification attempt: the VerifyResult + rejection flag."""

    result: VerifyResult
    rejected: bool


async def run_verification(
    db: AsyncSession,
    *,
    session: Session,
    student_id: str,
    device_uuid: str,
    qr_token: str,
    audio_nonce: str,
) -> VerifyOutcome:
    """
    Run the 4-step attendance verification for a given student/device against a
    session, using the provided QR + audio nonce. Mirrors /attendance/verify
    exactly. Commits on success (writes an Attendance row).
    """
    redis = get_redis()

    # (1) auth window open
    window_open = session.status == "open" and as_aware(session.window_expires_at) > _now()
    if not window_open:
        return VerifyOutcome(
            _rejected(VerifyReason.window_closed, cross=False, device=False), True
        )

    # (2) QR x audio cross-verify
    if not await cross_verify(redis, session.id, qr_token, audio_nonce):
        return VerifyOutcome(
            _rejected(VerifyReason.cross_verify_failed, cross=False, device=False), True
        )

    # (3) device_uuid matches the account's active binding
    binding = (
        await db.execute(
            select(Device).where(Device.user_id == student_id, Device.is_active.is_(True))
        )
    ).scalar_one_or_none()
    if binding is None or binding.device_uuid != device_uuid:
        return VerifyOutcome(
            _rejected(VerifyReason.device_mismatch, cross=True, device=False), True
        )

    # (4) uniqueness: one attendance per (session, student) AND per (session, device)
    dup = (
        await db.execute(
            select(Attendance).where(
                Attendance.session_id == session.id,
                (Attendance.student_id == student_id)
                | (Attendance.device_uuid == device_uuid),
            )
        )
    ).scalar_one_or_none()
    if dup is not None:
        return VerifyOutcome(
            _rejected(VerifyReason.duplicate_attendance, cross=True, device=True), True
        )

    record = Attendance(
        session_id=session.id,
        student_id=student_id,
        device_uuid=device_uuid,
        status="present",
        verified_at=_now(),
    )
    db.add(record)
    try:
        await db.commit()
    except IntegrityError:
        # race: uniqueness enforced at DB level
        await db.rollback()
        return VerifyOutcome(
            _rejected(VerifyReason.duplicate_attendance, cross=True, device=True), True
        )

    absences = await absence_count(db, student_id, course_id=session.course_id)
    return VerifyOutcome(
        VerifyResult(
            status=VerifyStatus.present,
            cross_verified=True,
            device_matched=True,
            reason=None,
            risk_warning=risk_warning_for(absences),
        ),
        False,
    )


def _rejected(reason: VerifyReason, *, cross: bool, device: bool) -> VerifyResult:
    return VerifyResult(
        status=VerifyStatus.rejected,
        cross_verified=cross,
        device_matched=device,
        reason=reason,
        risk_warning=None,
    )
