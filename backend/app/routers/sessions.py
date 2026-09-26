"""
Sessions router — professor-controlled auth window + rotating tokens.

operationIds: createSession, extendWindow, closeSession, getSessionToken.
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import CurrentUser, require_professor
from app.models import Course, Session
from app.redis_client import get_redis
from app.schemas import (
    CreateSessionRequest,
    ExtendWindowRequest,
    SessionOut,
    SessionToken,
)
from app.services.ownership import load_owned_session
from app.services.tokens import issue_tokens
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
    window = body.window_seconds or get_settings().auth_window_seconds
    now = _now()
    session = Session(
        course_id=body.course_id,
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
    qr, audio = await issue_tokens(get_redis(), session.id)
    return SessionToken(
        session_id=session.id,
        qr_token=qr,
        audio_nonce=audio,
        expires_in=get_settings().nonce_ttl_seconds,
        window_open=is_open,
        window_remaining=remaining,
    )
