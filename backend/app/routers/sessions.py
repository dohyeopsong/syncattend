"""
Sessions router — professor-controlled auth window + rotating tokens.

operationIds: createSession, extendWindow, closeSession, getSessionToken.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import CurrentUser, require_professor
from app.models import Course, CourseSchedule, Session
from app.redis_client import get_redis
from app.schemas import (
    CreateSessionRequest,
    ExtendWindowRequest,
    SessionOut,
    SessionToken,
    SimulationCase,
    SimulationResult,
    VerifyReason,
)
from app.services.ownership import load_owned_session
from app.services.tokens import get_or_rotate_tokens, issue_tokens
from app.services.verify import run_verification
from app.timeutil import as_aware, now as _now

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _window_state(session: Session) -> tuple[bool, int]:
    """Return (window_open, window_remaining_seconds)."""
    if session.status != "open":
        return False, 0
    remaining = int((as_aware(session.window_expires_at) - _now()).total_seconds())
    if remaining <= 0:
        return False, 0
    return True, remaining


def _to_out(session: Session) -> SessionOut:
    is_open, remaining = _window_state(session)
    return SessionOut(
        session_id=session.id,
        course_id=session.course_id,
        week_number=session.week_number,
        schedule_id=session.schedule_id,
        window_open=is_open,
        window_remaining=remaining,
        status=session.status,
    )


async def _load_owned_session(
    db: AsyncSession, session_id: str, professor_id: str
) -> Session:
    return await load_owned_session(db, session_id, professor_id)


@router.post(
    "", response_model=SessionOut, status_code=status.HTTP_201_CREATED,
    operation_id="createSession",
)
async def create_session(
    body: CreateSessionRequest,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    course = (
        await db.execute(select(Course).where(Course.id == body.course_id))
    ).scalar_one_or_none()
    if course is None or course.professor_id != prof.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="not your course"
        )
    # If a weekly slot is given, it must belong to this course.
    if body.schedule_id is not None:
        slot = (
            await db.execute(
                select(CourseSchedule).where(CourseSchedule.id == body.schedule_id)
            )
        ).scalar_one_or_none()
        if slot is None or slot.course_id != body.course_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="schedule_id does not belong to this course",
            )
    window = body.window_seconds or get_settings().auth_window_seconds
    now = _now()
    session = Session(
        course_id=body.course_id,
        week_number=body.week_number,
        schedule_id=body.schedule_id,
        status="open",
        window_opened_at=now,
        window_expires_at=now + timedelta(seconds=window),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _to_out(session)


@router.post(
    "/{id}/window/extend", response_model=SessionOut, operation_id="extendWindow"
)
async def extend_window(
    id: str,
    body: ExtendWindowRequest | None = None,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    session = await _load_owned_session(db, id, prof.id)
    add_seconds = (body.add_seconds if body else None) or get_settings().auth_window_seconds
    now = _now()
    base = max(as_aware(session.window_expires_at), now)
    session.status = "open"
    session.window_expires_at = base + timedelta(seconds=add_seconds)
    await db.commit()
    await db.refresh(session)
    return _to_out(session)


@router.post("/{id}/close", response_model=SessionOut, operation_id="closeSession")
async def close_session(
    id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    session = await _load_owned_session(db, id, prof.id)
    session.status = "closed"
    await db.commit()
    await db.refresh(session)
    return _to_out(session)


@router.get("/{id}/token", response_model=SessionToken, operation_id="getSessionToken")
async def get_session_token(
    id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> SessionToken:
    session = await _load_owned_session(db, id, prof.id)
    is_open, remaining = _window_state(session)
    # Reuse the current token until near-expiry; only rotate when its TTL is
    # almost up. Polling this endpoint must NOT rotate every call (that made
    # the rotation period equal the poll interval). expires_in is the real
    # remaining TTL so the client countdown is accurate.
    qr, audio, expires_in = await get_or_rotate_tokens(get_redis(), session.id)
    return SessionToken(
        session_id=session.id,
        qr_token=qr,
        audio_nonce=audio,
        expires_in=expires_in,
        window_open=is_open,
        window_remaining=remaining,
    )


# --------------------------------------------------------------- simulation
# Virtual attendance simulation: create synthetic students + devices, then run
# every verify case (normal / window-closed / cross-verify-fail / device-mismatch
# / duplicate) through the REAL verification path so the professor can confirm
# each gate behaves as designed. Optionally cleans up synthetic data afterwards.
# Bot-population (course-scoped create + cleanup + wait-for-session verify) lives
# in app/services/simulation.py and is wired from the courses router.

from app.services.simulation import cleanup_sim, make_sim_student


@router.post(
    "/{id}/simulate",
    response_model=SimulationResult,
    operation_id="simulateAttendance",
)
async def simulate_attendance(
    id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> SimulationResult:
    """Run all attendance-verification cases against this session.

    Creates synthetic students on the fly and exercises the real verify path
    (run_verification) for each scenario:
      1. normal        — valid token + bound device         → present
      2. window_closed — window expired                     → window_closed
      3. cross_fail    — wrong QR/audio pair                → cross_verify_failed
      4. device_mismatch — unbound device uuid              → device_mismatch
      5. duplicate     — same student verifies twice        → duplicate_attendance

    Synthetic data is cleaned up at the end. Each case reports whether the
    actual outcome matched the expected one (`passed`).
    """
    session = await _load_owned_session(db, id, prof.id)
    course_id = session.course_id
    cases: list[SimulationCase] = []

    try:
        # Real tokens for this open session (used by the passing cases).
        qr, audio = await issue_tokens(get_redis(), session.id)

        # --- Case 1: normal (valid token + bound device) → present ---
        uid, dev = await make_sim_student(db, label="normal", course_id=course_id)
        out = await run_verification(
            db, session=session, student_id=uid, device_uuid=dev,
            qr_token=qr, audio_nonce=audio,
        )
        cases.append(_case("정상 출석", False, None, out))

        # --- Case 2: window closed → window_closed ---
        # Use a fresh token but a closed (expired) session snapshot: we can't
        # close the real session mid-simulation, so craft a session-shaped
        # object whose status/expiry read as closed. Verify checks status +
        # window_expires_at; clone via a lightweight stand-in.
        closed_session = _ClosedSessionView(session)
        uid2, dev2 = await make_sim_student(db, label="closed", course_id=course_id)
        out2 = await run_verification(
            db, session=closed_session, student_id=uid2, device_uuid=dev2,
            qr_token=qr, audio_nonce=audio,
        )
        cases.append(_case("인증 창 닫힘", True, VerifyReason.window_closed, out2))

        # --- Case 3: cross-verify fail (wrong QR/audio) → cross_verify_failed ---
        uid3, dev3 = await make_sim_student(db, label="crossfail", course_id=course_id)
        out3 = await run_verification(
            db, session=session, student_id=uid3, device_uuid=dev3,
            qr_token="wrong-qr-token", audio_nonce="wrong-audio",
        )
        cases.append(_case("QR/음향 불일치", True, VerifyReason.cross_verify_failed, out3))

        # --- Case 4: device mismatch (unbound device uuid) → device_mismatch ---
        uid4, _ = await make_sim_student(db, label="devmis", course_id=course_id)
        out4 = await run_verification(
            db, session=session, student_id=uid4, device_uuid="unbound-device-uuid",
            qr_token=qr, audio_nonce=audio,
        )
        cases.append(_case("기기 불일치", True, VerifyReason.device_mismatch, out4))

        # --- Case 5: duplicate (same student twice) → duplicate_attendance ---
        uid5, dev5 = await make_sim_student(db, label="dup", course_id=course_id)
        # First verify succeeds (present).
        await run_verification(
            db, session=session, student_id=uid5, device_uuid=dev5,
            qr_token=qr, audio_nonce=audio,
        )
        # Second verify by the SAME student+device → duplicate.
        out5 = await run_verification(
            db, session=session, student_id=uid5, device_uuid=dev5,
            qr_token=qr, audio_nonce=audio,
        )
        cases.append(_case("중복 출석", True, VerifyReason.duplicate_attendance, out5))
    finally:
        await cleanup_sim(db)

    return SimulationResult(session_id=session.id, cases=cases, cleaned_up=True)


@dataclass
class _ClosedSessionView:
    """A read-only stand-in of a Session that reports its window as closed,
    so the window-open check in run_verification fails without mutating the
    real session row."""

    _real: Session

    @property
    def id(self) -> str:
        return self._real.id

    @property
    def course_id(self) -> str:
        return self._real.course_id

    @property
    def status(self) -> str:
        return "closed"

    @property
    def window_expires_at(self):
        return self._real.window_expires_at


def _case(
    name: str,
    expected_rejected: bool,
    expected_reason: VerifyReason | None,
    outcome,
) -> SimulationCase:
    actual_reason = outcome.result.reason
    passed = outcome.rejected == expected_rejected and (
        expected_reason is None or actual_reason == expected_reason
    )
    return SimulationCase(
        name=name,
        expected_rejected=expected_rejected,
        expected_reason=expected_reason,
        rejected=outcome.rejected,
        reason=actual_reason,
        passed=passed,
    )


