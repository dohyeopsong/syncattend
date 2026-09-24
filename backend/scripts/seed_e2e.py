#!/usr/bin/env python3
"""
E2E seed — populate a running database with fixed accounts/course/session so
the mobile (B) and web (C) clients can log in and exercise the full flow
immediately after `docker compose up`.

Idempotent: safe to run repeatedly. Existing rows (matched by email / natural
key) are reused; a fresh OPEN session is (re)opened each run so the 1-minute
auth window is live for testing.

Run (from backend/, with the stack up and DATABASE_URL pointing at Postgres):
    python -m scripts.seed_e2e
    # or override the window:
    SEED_WINDOW_SECONDS=600 python -m scripts.seed_e2e

Prints a summary (including seed login credentials) as JSON on stdout.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_engine, get_sessionmaker
from app.models import Course, Device, Enrollment, Session, User
from app.security import hash_password

# --- Fixed seed identities (documented for B/C) ------------------------------
SEED_PASSWORD = "seedpass123"

PROFESSOR = {"email": "prof.e2e@wku.ac.kr", "name": "E2E Professor", "role": "professor"}
STUDENTS = [
    {"email": "student1.e2e@wku.ac.kr", "name": "E2E Student One", "role": "student"},
    {"email": "student2.e2e@wku.ac.kr", "name": "E2E Student Two", "role": "student"},
]
COURSE_NAME = "E2E Integration 101"
# Deterministic device UUIDs so B can bind without guesswork (student1 pre-bound).
STUDENT1_DEVICE_UUID = "11111111-1111-1111-1111-111111111111"

_WINDOW_SECONDS = int(os.environ.get("SEED_WINDOW_SECONDS", "600"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _get_or_create_user(db: AsyncSession, spec: dict) -> User:
    user = (
        await db.execute(select(User).where(User.email == spec["email"]))
    ).scalar_one_or_none()
    if user is not None:
        return user
    user = User(
        email=spec["email"],
        password_hash=hash_password(SEED_PASSWORD),
        role=spec["role"],
        name=spec["name"],
    )
    db.add(user)
    await db.flush()
    return user


async def _get_or_create_course(db: AsyncSession, professor_id: str) -> Course:
    course = (
        await db.execute(
            select(Course).where(
                Course.professor_id == professor_id, Course.name == COURSE_NAME
            )
        )
    ).scalar_one_or_none()
    if course is not None:
        return course
    course = Course(professor_id=professor_id, name=COURSE_NAME)
    db.add(course)
    await db.flush()
    return course


async def _ensure_enrollment(db: AsyncSession, course_id: str, student_id: str) -> None:
    existing = (
        await db.execute(
            select(Enrollment).where(
                Enrollment.course_id == course_id,
                Enrollment.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(Enrollment(course_id=course_id, student_id=student_id))


async def _ensure_device(db: AsyncSession, user_id: str, device_uuid: str) -> None:
    """Bind device_uuid to user if free; skip if already bound to this user."""
    existing = (
        await db.execute(select(Device).where(Device.device_uuid == device_uuid))
    ).scalar_one_or_none()
    if existing is not None:
        return  # already bound (idempotent); leave as-is
    db.add(Device(user_id=user_id, device_uuid=device_uuid, is_active=True))


async def _open_fresh_session(db: AsyncSession, course_id: str) -> Session:
    """(Re)open a live session so the auth window is valid for testing now."""
    now = _now()
    session = Session(
        course_id=course_id,
        status="open",
        window_opened_at=now,
        window_expires_at=now + timedelta(seconds=_WINDOW_SECONDS),
    )
    db.add(session)
    await db.flush()
    return session


async def seed() -> dict:
    sm = get_sessionmaker()
    async with sm() as db:
        prof = await _get_or_create_user(db, PROFESSOR)
        students = [await _get_or_create_user(db, s) for s in STUDENTS]
        course = await _get_or_create_course(db, prof.id)
        for st in students:
            await _ensure_enrollment(db, course.id, st.id)
        # Pre-bind student1's device so B can verify without re-registering.
        await _ensure_device(db, students[0].id, STUDENT1_DEVICE_UUID)
        session = await _open_fresh_session(db, course.id)
        await db.commit()

        return {
            "password_for_all": SEED_PASSWORD,
            "professor": {"id": prof.id, "email": prof.email},
            "students": [
                {"id": students[0].id, "email": students[0].email,
                 "device_uuid": STUDENT1_DEVICE_UUID, "device_prebound": True},
                {"id": students[1].id, "email": students[1].email,
                 "device_prebound": False},
            ],
            "course": {"id": course.id, "name": course.name},
            "open_session": {
                "id": session.id,
                "window_seconds": _WINDOW_SECONDS,
                "expires_at": session.window_expires_at.isoformat(),
            },
        }


async def _main() -> None:
    try:
        summary = await seed()
        print(json.dumps(summary, indent=2))
    finally:
        await get_engine().dispose()


if __name__ == "__main__":
    asyncio.run(_main())
