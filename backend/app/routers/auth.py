"""Auth router — register / login / refresh (operationIds: registerUser, login, refresh)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import CurrentUser, get_current_user
from app.models import User
from app.schemas import (
    LoginRequest,
    RefreshRequest,
    RegisterUserRequest,
    Role,
    TokenPair,
    UserOut,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="registerUser",
)
async def register_user(
    body: RegisterUserRequest, db: AsyncSession = Depends(get_db)
) -> UserOut:
    settings = get_settings()
    # Identity defense: student accounts must use the school domain.
    if body.role == Role.student and not body.email.lower().endswith(
        settings.school_email_domain
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"student email must be a {settings.school_email_domain} address",
        )
    existing = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email already registered"
        )
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role.value,
        name=body.name,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserOut(id=user.id, email=user.email, role=Role(user.role), name=user.name)


@router.post("/login", response_model=TokenPair, operation_id="login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    user = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )
    return TokenPair(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id, user.role),
        role=Role(user.role),
    )


@router.get("/me", response_model=UserOut, operation_id="getMe")
async def get_me(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    """
    Return the authenticated user's profile (id/email/role/name).

    Lets a client resolve its own account id from an access token alone —
    e.g. the mobile app subscribing to /sse/students/{id} without a "me"
    placeholder, and without decoding the JWT client-side.
    """
    account = (
        await db.execute(select(User).where(User.id == user.id))
    ).scalar_one_or_none()
    if account is None:  # token valid but account gone (rare race)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found"
        )
    return UserOut(
        id=account.id,
        email=account.email,
        role=Role(account.role),
        name=account.name,
    )


@router.post("/refresh", response_model=TokenPair, operation_id="refresh")
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    try:
        payload = decode_token(body.refresh_token, expected_type="refresh")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid refresh token"
        )
    user = (
        await db.execute(select(User).where(User.id == payload.get("sub")))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found"
        )
    return TokenPair(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id, user.role),
        role=Role(user.role),
    )
