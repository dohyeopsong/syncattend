"""FastAPI dependencies: authentication + role guards."""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import User
from app.security import decode_token

_bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: str
    role: str
    email: str


async def _resolve_user(token: str | None, db: AsyncSession) -> CurrentUser:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token"
        )
    try:
        payload = decode_token(token, expected_type="access")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token"
        )
    user_id = payload.get("sub")
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found"
        )
    return CurrentUser(id=user.id, role=user.role, email=user.email)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    return await _resolve_user(creds.credentials if creds else None, db)


async def require_professor(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if user.role != "professor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="professor role required"
        )
    return user


# SSE auth: EventSource cannot set Authorization headers, so the stream
# endpoints accept the access token as a ?access_token= query param instead.
# Falls back to the bearer header when the query param is absent (e.g. direct
# curl). Resolves the SAME user as get_current_user so role guards compose.
async def get_current_user_for_sse(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    access_token: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    token = (creds.credentials if creds else None) or access_token
    return await _resolve_user(token, db)


async def require_professor_for_sse(
    user: CurrentUser = Depends(get_current_user_for_sse),
) -> CurrentUser:
    if user.role != "professor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="professor role required"
        )
    return user
