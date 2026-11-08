"""
Virtual bot-student simulation helpers — shared by the 5-case gate simulation
(sessions router) and the course-scoped bot-population endpoints (courses
router).

Bots are synthetic students prefixed `sim_` so they are easy to identify and
clean up. The bot-population flow is COURSE-scoped so a professor can create
bots (enroll them as 미인증 course students) BEFORE opening a session; the
present bots then wait for the session's auth window to open and verify
through the REAL path after a per-bot random delay, so 출석 trickles into the
realtime dashboard (SSE) one-by-one.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_sessionmaker
from app.models import Attendance, Device, Enrollment, Session, User
from app.redis_client import get_redis
from app.security import hash_password
from app.services.tokens import issue_tokens
from app.services.verify import run_verification
from app.timeutil import as_aware, now as _now

SIM_PREFIX = "sim_"

# Max time a present bot waits for the professor to open an auth window before
# giving up (the bot then stays 미인증). Bounded so a forgotten session does
# not leak background tasks forever.
BOT_WINDOW_WAIT_SECONDS = 600


async def make_sim_student(
    db: AsyncSession, *, label: str, course_id: str, device_uuid: str | None = None
) -> tuple[str, str]:
    """Create a synthetic student + active device binding + course enrollment.

    Returns (user_id, device_uuid). The email/name are prefixed so simulation
    data is easy to identify and clean up. UUID-based labels guarantee
    uniqueness across repeated (additive) bot-creation calls.
    """
    email = f"{SIM_PREFIX}{label}@wku.ac.kr"
    user = User(
        email=email,
        password_hash=hash_password("sim-password-12345"),
        role="student",
        name=f"시뮬_{label}",
        student_id=f"SIM{label}",
    )
    db.add(user)
    await db.flush()  # get user.id
    dev_uuid = device_uuid or f"{SIM_PREFIX}dev_{label}"
    db.add(Device(user_id=user.id, device_uuid=dev_uuid, is_active=True))
    db.add(Enrollment(course_id=course_id, student_id=user.id))
    await db.flush()
    return user.id, dev_uuid


async def cleanup_sim(db: AsyncSession) -> int:
    """Delete synthetic users AND their dependent rows so simulation leaves no
    residue. Postgres would CASCADE these via FK ondelete=CASCADE, but SQLite
    (used in tests) does not enforce FK cascades, so we delete the children
    explicitly to stay correct in both. Returns the count of users removed."""
    sims = (
        await db.execute(select(User).where(User.email.like(f"{SIM_PREFIX}%")))
    ).scalars().all()
    if not sims:
        return 0
    sim_ids = [s.id for s in sims]
    # Children first (order: attendance → enrollment → device), then users.
    await db.execute(sa_delete(Attendance).where(Attendance.student_id.in_(sim_ids)))
    await db.execute(sa_delete(Enrollment).where(Enrollment.student_id.in_(sim_ids)))
    await db.execute(sa_delete(Device).where(Device.user_id.in_(sim_ids)))
    for s in sims:
        await db.delete(s)
    await db.commit()
    return len(sims)


async def verify_bot_for_course(
    course_id: str, student_id: str, device_uuid: str, delay: float,
) -> None:
    """Background task: verify attendance for an already-enrolled bot student
    through the REAL path, once the course's session opens its auth window.

    The professor creates bots BEFORE opening the session, so this task first
    waits for an open auth window on any session of this course (bounded by
    BOT_WINDOW_WAIT_SECONDS). Once open, it sleeps the per-bot random delay,
    then verifies against that session. Each bot issues its own fresh token
    immediately before verifying — tokens expire in 15s, so a bot verifying at
    t+20s cannot reuse a token issued at t=0. The dashboard (SSE polling every
    2s) thus sees attendance trickle in one-by-one over the delay window. If
    the window closed again before the verify lands, the bot simply stays
    미인증 (run_verification rejects with window_closed and writes nothing).
    """
    # Wait for the auth window to open on a session of this course.
    deadline = _now() + timedelta(seconds=BOT_WINDOW_WAIT_SECONDS)
    session_id: str | None = None
    while session_id is None:
        async with get_sessionmaker()() as db:
            sess = (
                await db.execute(
                    select(Session)
                    .where(Session.course_id == course_id, Session.phase != "closed")
                    .order_by(Session.window_expires_at.desc())
                )
            ).scalars().first()
            if sess is not None and as_aware(sess.window_expires_at) > _now():
                session_id = sess.id
        if session_id is not None:
            break
        if _now() >= deadline:
            return  # window never opened; bot stays 미인증
        await asyncio.sleep(1.0)

    # Window is open → apply the per-bot random delay, then verify.
    if delay > 0:
        await asyncio.sleep(delay)
    async with get_sessionmaker()() as db:
        sess = (
            await db.execute(select(Session).where(Session.id == session_id))
        ).scalar_one_or_none()
        if sess is None:
            return  # session deleted while we were waiting
        qr, audio = await issue_tokens(get_redis(), sess.id)
        await run_verification(
            db, session=sess, student_id=student_id, device_uuid=device_uuid,
            qr_token=qr, audio_nonce=audio,
        )


# Re-exported so the sessions router's 5-case simulate_attendance can build a
# rejected-outcome shape without duplicating the reason mapping.
__all__ = [
    "SIM_PREFIX",
    "BOT_WINDOW_WAIT_SECONDS",
    "make_sim_student",
    "cleanup_sim",
    "verify_bot_for_course",
]
