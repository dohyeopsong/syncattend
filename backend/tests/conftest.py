"""
Pytest fixtures — in-memory SQLite + fakeredis, dependency overrides.

The suite runs without a real Postgres/Redis so it is CI-friendly and fast.
Uniqueness constraints, single-use nonce, window logic, cross-verify and
device binding are all exercised against the same ORM models used in prod.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Force fake redis before app modules read settings.
import os

os.environ["REDIS_URL"] = "fakeredis://"

from app import db as app_db  # noqa: E402
from app import redis_client as app_redis  # noqa: E402
from app.deps import get_current_user, CurrentUser  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Course, Enrollment, Session, User  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Point the app's sessionmaker at this test engine.
    app_db._engine = eng
    app_db._sessionmaker = async_sessionmaker(
        eng, expire_on_commit=False, class_=AsyncSession
    )
    yield eng
    await eng.dispose()
    app_db._engine = None
    app_db._sessionmaker = None


@pytest_asyncio.fixture
async def session(engine) -> AsyncSession:
    async with async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)() as s:
        yield s


@pytest_asyncio.fixture(autouse=True)
async def _flush_redis():
    await app_redis.reset_redis()
    yield
    await app_redis.reset_redis()


@pytest_asyncio.fixture
async def client(engine) -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# ------------------------------------------------------------- seed helpers
def _now():
    return datetime.now(timezone.utc)


async def seed_user(session, email, password="pw123456", role="student", name=None):
    user = User(
        email=email, password_hash=hash_password(password), role=role, name=name
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def seed_course(session, professor_id, name="CS101"):
    course = Course(professor_id=professor_id, name=name)
    session.add(course)
    await session.commit()
    await session.refresh(course)
    return course


async def seed_enrollment(session, course_id, student_id):
    session.add(Enrollment(course_id=course_id, student_id=student_id))
    await session.commit()


async def seed_open_session(session, course_id, window_seconds=60):
    now = _now()
    s = Session(
        course_id=course_id,
        status="open",
        window_opened_at=now,
        window_expires_at=now + timedelta(seconds=window_seconds),
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


def auth_header(user_id, role):
    return {"Authorization": f"Bearer {create_access_token(user_id, role)}"}
