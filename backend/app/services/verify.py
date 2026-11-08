"""
Attendance verification logic — extracted so the real /attendance/verify
endpoint and the simulation endpoint share ONE code path.

The 4-step server verification (in order):
  (1) auth window open        -> window_closed
  (2) QR x audio cross-verify -> cross_verify_failed
  (3) device_uuid matches     -> device_mismatch
  (4) uniqueness (acct+device)-> duplicate_attendance

Dual-auth: the session phase (check_in / check_out) decides WHICH timestamp a
successful verify records. A verify in check_in sets check_in_verified_at; in
check_out it sets check_out_verified_at. The final attendance status
(present/late/early_leave/absent) is NOT decided here — it is derived from the
two timestamps at batchClose. A successful verify returns VerifyStatus.verified.

Returns a VerifyResult; the caller sets the HTTP status (409 on rejection).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Attendance, Device, Session
from app.redis_client import get_redis
from app.schemas import CheckPhase, VerifyReason, VerifyResult, VerifyStatus
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
    exactly. Commits on success (writes/updates an Attendance row).
    """
    redis = get_redis()

    # (1) auth window open — any phase other than `closed` with time left.
    window_open = (
        session.phase != "closed" and as_aware(session.window_expires_at) > _now()
    )
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

    # The current phase tells us which timestamp a success records.
    phase = session.phase  # "check_in" | "check_out"

    # (4) phase-aware uniqueness: one attendance row per (session, student).
    # If a row exists, the SAME device must be used (anti-forgery), and the
    # current phase's timestamp must not already be set (else duplicate).
    existing = (
        await db.execute(
            select(Attendance).where(
                Attendance.session_id == session.id,
                Attendance.student_id == student_id,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        if existing.device_uuid != device_uuid:
            # Same account, different device — the row was created on another
            # device; reject as device_mismatch (do not let a second device
            # attach to the same attendance row).
            return VerifyOutcome(
                _rejected(VerifyReason.device_mismatch, cross=True, device=False), True
            )
        if phase == "check_in":
            if existing.check_in_verified_at is not None:
                return VerifyOutcome(
                    _rejected(
                        VerifyReason.duplicate_attendance, cross=True, device=True
                    ),
                    True,
                )
            existing.check_in_verified_at = _now()
        else:  # check_out
            if existing.check_out_verified_at is not None:
                return VerifyOutcome(
                    _rejected(
                        VerifyReason.duplicate_attendance, cross=True, device=True
                    ),
                    True,
                )
            existing.check_out_verified_at = _now()
        existing.status = "pending"
        try:
            await db.commit()
        except IntegrityError:
            # race: uniqueness enforced at DB level (e.g. device axis collision)
            await db.rollback()
            return VerifyOutcome(
                _rejected(VerifyReason.duplicate_attendance, cross=True, device=True),
                True,
            )
    else:
        # No row yet — INSERT. A collision on UNIQUE(session, device) means a
        # different student already used this device for this session.
        record = Attendance(
            session_id=session.id,
            student_id=student_id,
            device_uuid=device_uuid,
            status="pending",
            check_in_verified_at=_now() if phase == "check_in" else None,
            check_out_verified_at=_now() if phase == "check_out" else None,
        )
        db.add(record)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return VerifyOutcome(
                _rejected(VerifyReason.duplicate_attendance, cross=True, device=True),
                True,
            )

    absences = await absence_count(db, student_id, course_id=session.course_id)
    return VerifyOutcome(
        VerifyResult(
            status=VerifyStatus.verified,
            cross_verified=True,
            device_matched=True,
            reason=None,
            check_phase=CheckPhase(phase),
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
        check_phase=None,
        risk_warning=None,
    )
