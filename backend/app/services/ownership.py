"""
Session ownership helper.

Loads a session by id and asserts the requesting professor owns the session's
course. Extracted from sessions.py / attendance.py, which each carried an
identical copy. Response codes/conditions are unchanged:

  - session not found      -> 404 "session not found"
  - course missing OR not owned by professor -> 403 "not your session"
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Course, Session


async def load_owned_session(
    db: AsyncSession, session_id: str, professor_id: str
) -> Session:
    session = (
        await db.execute(select(Session).where(Session.id == session_id))
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="session not found"
        )
    course = (
        await db.execute(select(Course).where(Course.id == session.course_id))
    ).scalar_one_or_none()
    if course is None or course.professor_id != professor_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="not your session"
        )
    return session
