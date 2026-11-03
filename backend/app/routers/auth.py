"""Auth router — register / login / refresh (operationIds: registerUser, login, refresh).

Signup uses the team member's email-verification flow:
  POST /auth/send-code   → email 6-digit code (SMTP or dev-stub log)
  POST /auth/verify-code → mark the email verified in Redis (15 min TTL)
  POST /auth/register    → create the account (only if the email is verified)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import CurrentUser, get_current_user
from app.models import User
from app.redis_client import get_redis
from app.schemas import (
    LoginRequest,
    RefreshRequest,
    RegisterUserRequest,
    Role,
    SendCodeRequest,
    TokenPair,
    UserOut,
    VerifyCodeRequest,
    VerifyCodeResult,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.services.email_codes import (
    consume_signup_verified,
    is_signup_verified,
    issue_signup_code,
    verify_signup_code,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/send-code",
    response_model=VerifyCodeResult,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="sendSignupCode",
)
async def send_signup_code(
    body: SendCodeRequest, db: AsyncSession = Depends(get_db)
) -> VerifyCodeResult:
    """Email a 6-digit verification code for signup.

    Rejects already-registered emails (409) and non-school domains (400).
    Delivery is via SMTP when configured, otherwise logged as a dev stub.
    """
    settings = get_settings()
    email = body.email
    if not email.endswith(settings.school_email_domain):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{settings.school_email_domain} 도메인의 학교 이메일만 사용 가능합니다.",
        )
    existing = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 가입된 이메일입니다.",
        )
    try:
        await issue_signup_code(get_redis(), email)
    except Exception as e:  # SMTP failure
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"이메일 발송 실패: {e}",
        )
    return VerifyCodeResult(
        verified=False, message="인증번호가 이메일로 발송되었습니다."
    )


@router.post(
    "/verify-code",
    response_model=VerifyCodeResult,
    operation_id="verifySignupCode",
)
async def verify_signup_code_route(
    body: VerifyCodeRequest,
) -> VerifyCodeResult:
    """Verify the 6-digit code. On success the email is marked verified in Redis
    and may be used to complete /auth/register within the TTL (15 min)."""
    ok = await verify_signup_code(get_redis(), body.email, body.code)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="인증번호가 일치하지 않거나 만료되었습니다.",
        )
    return VerifyCodeResult(
        verified=True, message="이메일 인증이 완료되었습니다."
    )


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
    # Signup gate: the email must have completed /auth/verify-code first.
    if not await is_signup_verified(get_redis(), body.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이메일 인증을 먼저 완료해주세요.",
        )
    existing = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email already registered"
        )
    # Student number (학번) uniqueness: enforced by a DB UNIQUE constraint, but
    # we check here first to return a clear 409 instead of a 500 IntegrityError.
    if body.student_id:
        clash = (
            await db.execute(
                select(User).where(User.student_id == body.student_id.strip())
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="이미 사용 중인 학번입니다.",
            )
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role.value,
        name=body.name,
        student_id=body.student_id.strip() if body.student_id else None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    # consume the verified flag so the same code cannot register twice
    await consume_signup_verified(get_redis(), body.email)
    return UserOut(
        id=user.id,
        email=user.email,
        role=Role(user.role),
        name=user.name,
        student_id=user.student_id,
    )


@router.post("/login", response_model=TokenPair, operation_id="login")
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
    client_type: str | None = Header(default=None, alias="X-Client-Type"),
) -> TokenPair:
    user = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )
    # Client gating: the web dashboard is professor-only and the mobile app is
    # student-only. The client declares itself via X-Client-Type (web|mobile);
    # a mismatch (e.g. a student logging into the web) is rejected here so the
    # check cannot be bypassed by calling the API directly without the UI guard.
    if client_type == "web" and user.role != Role.professor.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="교수 계정만 웹 대시보드에 로그인할 수 있습니다.",
        )
    if client_type == "mobile" and user.role != Role.student.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="학생 계정만 모바일 앱에 로그인할 수 있습니다.",
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
        student_id=account.student_id,
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
