"""
Devices router — app-generated UUID binding + @wku.ac.kr re-registration.

operationIds: registerDevice, reregisterRequest, reregisterConfirm, getMyDevice.

Binding policy (identity defense): a new/unknown UUID is NOT auto-bound when the
account already has an active binding to a different UUID. The client must then
go through email re-auth (/devices/reregister/*).
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.deps import CurrentUser, get_current_user
from app.models import Device, DeviceChange, User
from app.redis_client import get_redis
from app.schemas import (
    DeviceBinding,
    RegisterDeviceRequest,
    ReregisterConfirmBody,
    ReregisterRequestBody,
)
from app.services.email_codes import issue_reregister_code, verify_reregister_code

router = APIRouter(prefix="/devices", tags=["devices"])


async def _active_binding(db: AsyncSession, user_id: str) -> Device | None:
    return (
        await db.execute(
            select(Device).where(Device.user_id == user_id, Device.is_active.is_(True))
        )
    ).scalar_one_or_none()


@router.post("/register", response_model=DeviceBinding, operation_id="registerDevice")
async def register_device(
    body: RegisterDeviceRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceBinding:
    existing = await _active_binding(db, user.id)
    if existing is not None:
        if existing.device_uuid == body.device_uuid:
            return DeviceBinding(
                account_id=user.id,
                device_uuid=existing.device_uuid,
                bound_at=existing.bound_at,
            )
        # Conflict: account already bound to a different UUID → email re-auth required.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="등록된 계정과 일치하지 않습니다. 기기 재등록이 필요합니다. (/devices/reregister/*)",
        )

    # UUID must be globally unique (one device per account). When the UUID is
    # already bound to ANOTHER account, the client must go through email
    # re-registration to prove ownership of the email it wants to bind, which
    # detaches the UUID from the old account and binds it to the verified one.
    uuid_taken = (
        await db.execute(select(Device).where(Device.device_uuid == body.device_uuid))
    ).scalar_one_or_none()
    if uuid_taken is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="등록된 계정과 일치하지 않습니다. 기기 재등록이 필요합니다. (/devices/reregister/*)",
        )

    device = Device(user_id=user.id, device_uuid=body.device_uuid, is_active=True)
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return DeviceBinding(
        account_id=user.id, device_uuid=device.device_uuid, bound_at=device.bound_at
    )


@router.post(
    "/reregister/request",
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="reregisterRequest",
)
async def reregister_request(
    body: ReregisterRequestBody,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Issue a verification code for the email the user wants to (re)bind.

    The email does NOT need to match the currently logged-in account — the
    whole point of re-registration is to switch the device UUID to a different
    email. The caller proves ownership of the target email via the code, then
    /reregister/confirm detaches the UUID from any prior account and binds it
    to this email (creating the account if it does not yet exist).
    """
    settings = get_settings()
    if not body.email.lower().endswith(settings.school_email_domain):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{settings.school_email_domain} 도메인의 학교 이메일만 사용 가능합니다.",
        )
    await issue_reregister_code(get_redis(), body.email)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post(
    "/reregister/confirm",
    response_model=DeviceBinding,
    operation_id="reregisterConfirm",
)
async def reregister_confirm(
    body: ReregisterConfirmBody,
    db: AsyncSession = Depends(get_db),
) -> DeviceBinding:
    """Complete device re-registration.

    Requires the email to have been verified via /reregister/request +
    verify-code. Then:
      1. Find the target account by email. If it does not exist yet, create it
         (with a random password — the user will set one via signup later, or
         log in with the email if the account already existed).
      2. Detach the new_device_uuid from ANY account it is currently bound to
         (deactivate, do NOT delete the old account or its attendance records).
      3. Deactivate any active binding on the target account.
      4. Bind the new_device_uuid to the target account as active.
      5. Record a DeviceChange audit row.
    """
    ok = await verify_reregister_code(get_redis(), body.email, body.code)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="인증번호가 일치하지 않거나 만료되었습니다.",
        )

    # 1. resolve or create the target account
    target = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if target is None:
        # New email → create a fresh student account. Password hash is a random
        # non-verifiable placeholder so the account cannot be logged into until
        # the user completes full signup and sets a real password.
        from app.security import hash_password

        target = User(
            email=body.email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            role="student",
            name=None,
        )
        db.add(target)
        await db.flush()  # get target.id

    # 2. Find the UUID's currently-active binding (if any). We REUSE this row
    # rather than inserting a new one, because `device_uuid` carries a global
    # unique constraint — a second INSERT with the same UUID would violate it
    # even when the prior row is deactivated. Any inactive historical rows are
    # left untouched (audit trail).
    prior = (
        await db.execute(
            select(Device).where(
                Device.device_uuid == body.new_device_uuid,
                Device.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()

    # 3. deactivate the target account's current active binding (if any)
    old = await _active_binding(db, target.id)
    old_uuid = old.device_uuid if old else None
    if old is not None:
        old.is_active = False

    # 4. bind the UUID to the target account — reuse the existing row when one
    # exists, otherwise insert a fresh one.
    if prior is not None:
        prior.user_id = target.id
        prior.is_active = True
        prior.bound_at = func.now()
        new_device = prior
    else:
        new_device = Device(
            user_id=target.id, device_uuid=body.new_device_uuid, is_active=True
        )
        db.add(new_device)
    # 5. audit trail
    db.add(
        DeviceChange(
            user_id=target.id,
            old_device_uuid=old_uuid,
            new_device_uuid=body.new_device_uuid,
            verified_via="school_email",
        )
    )
    await db.commit()
    await db.refresh(new_device)
    return DeviceBinding(
        account_id=target.id,
        device_uuid=new_device.device_uuid,
        bound_at=new_device.bound_at,
    )


@router.get("/me", response_model=DeviceBinding, operation_id="getMyDevice")
async def get_my_device(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceBinding:
    binding = await _active_binding(db, user.id)
    if binding is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no active device binding"
        )
    return DeviceBinding(
        account_id=user.id, device_uuid=binding.device_uuid, bound_at=binding.bound_at
    )
