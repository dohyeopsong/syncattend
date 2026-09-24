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

_DEPT = "컴퓨터·소프트웨어공학과"

# Real Wonkwang CS courses (학수번호/학점 real; 요일·교시·강의실 are demo values).
# day_of_week: 0=Mon .. 4=Fri. All owned by the seed professor.
COURSES = [
    {"name": "컴퓨터개론",          "code": "374140", "credits": 3.0,
     "day_of_week": 0, "start_period": 1, "end_period": 2, "location": "공대 401"},
    {"name": "C언어프로그래밍",      "code": "374142", "credits": 3.0,
     "day_of_week": 0, "start_period": 3, "end_period": 4, "location": "공대 402"},
    {"name": "파이썬프로그래밍",     "code": "374141", "credits": 3.0,
     "day_of_week": 1, "start_period": 1, "end_period": 2, "location": "공대 403"},
    {"name": "고급프로그래밍언어",   "code": "374143", "credits": 3.0,
     "day_of_week": 1, "start_period": 3, "end_period": 4, "location": "공대 404"},
    {"name": "창의공학설계",         "code": "374004", "credits": 3.0,
     "day_of_week": 2, "start_period": 1, "end_period": 2, "location": "공대 405"},
    {"name": "자료구조",             "code": "374150", "credits": 3.0,
     "day_of_week": 2, "start_period": 3, "end_period": 4, "location": "공대 406"},
    {"name": "객체지향프로그래밍",   "code": "374151", "credits": 3.0,
     "day_of_week": 3, "start_period": 1, "end_period": 2, "location": "공대 407"},
    {"name": "웹(HTML5)프로그래밍",  "code": "374152", "credits": 3.0,
     "day_of_week": 4, "start_period": 3, "end_period": 4, "location": "공대 408"},
]
# The live attendance session opens against this course (student1 pre-bound device).
E2E_SESSION_COURSE = "C언어프로그래밍"
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


async def _get_or_create_course(
    db: AsyncSession, professor_id: str, spec: dict, professor_name: str | None
) -> Course:
    """Idempotent by (professor_id, name). Fills schedule/catalog metadata and
    backfills those fields on a pre-existing row so re-seeds stay current."""
    course = (
        await db.execute(
            select(Course).where(
                Course.professor_id == professor_id, Course.name == spec["name"]
            )
        )
    ).scalar_one_or_none()
    if course is None:
        course = Course(
            professor_id=professor_id,
            name=spec["name"],
            code=spec.get("code"),
            department=_DEPT,
            professor_name=professor_name,
            day_of_week=spec.get("day_of_week"),
            start_period=spec.get("start_period"),
            end_period=spec.get("end_period"),
            location=spec.get("location"),
            credits=spec.get("credits"),
        )
        db.add(course)
        await db.flush()
        return course
    # Backfill/refresh schedule metadata on existing rows (idempotent update).
    course.code = spec.get("code")
    course.department = _DEPT
    course.professor_name = professor_name
    course.day_of_week = spec.get("day_of_week")
    course.start_period = spec.get("start_period")
    course.end_period = spec.get("end_period")
    course.location = spec.get("location")
    course.credits = spec.get("credits")
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

        # Create the full Wonkwang CS course catalog (idempotent).
        courses = [
            await _get_or_create_course(db, prof.id, spec, prof.name) for spec in COURSES
        ]
        by_name = {c.name: c for c in courses}

        # Pre-enroll: student1 in the first 3 courses, student2 in 2 courses.
        # Both are enrolled in the session course so E2E attendance has takers.
        session_course = by_name[E2E_SESSION_COURSE]
        student1_courses = courses[:3] + [session_course]
        student2_courses = [session_course, by_name["파이썬프로그래밍"]]
        for c in student1_courses:
            await _ensure_enrollment(db, c.id, students[0].id)
        for c in student2_courses:
            await _ensure_enrollment(db, c.id, students[1].id)

        # Pre-bind student1's device so B can verify without re-registering.
        await _ensure_device(db, students[0].id, STUDENT1_DEVICE_UUID)
        session = await _open_fresh_session(db, session_course.id)
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
            "courses": [
                {"id": by_name[spec["name"]].id, "name": spec["name"],
                 "code": spec.get("code"), "credits": spec.get("credits"),
                 "day_of_week": spec.get("day_of_week"),
                 "start_period": spec.get("start_period"),
                 "end_period": spec.get("end_period"),
                 "location": spec.get("location")}
                for spec in COURSES
            ],
            "open_session": {
                "id": session.id,
                "course_id": session_course.id,
                "course_name": session_course.name,
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
