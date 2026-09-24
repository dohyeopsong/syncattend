"""
Devices router — app-generated UUID binding + @wku.ac.kr re-registration.

operationIds: registerDevice, reregisterRequest, reregisterConfirm, getMyDevice.

Binding policy (identity defense): a new/unknown UUID is NOT auto-bound when the
account already has an active binding to a different UUID. The client must then
go through email re-auth (/devices/reregister/*).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
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
            detail="account already bound to another device; re-registration required",
        )

    # UUID must be globally unique (one device per account).
    uuid_taken = (
        await db.execute(select(Device).where(Device.device_uuid == body.device_uuid))
    ).scalar_one_or_none()
    if uuid_taken is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="device_uuid already bound to another account",
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
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    settings = get_settings()
    if not body.email.lower().endswith(settings.school_email_domain):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"email must be a {settings.school_email_domain} address",
        )
    # email must match the authenticated account
    account = (
        await db.execute(select(User).where(User.id == user.id))
    ).scalar_one_or_none()
    if account is None or account.email.lower() != body.email.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email does not match account",
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
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceBinding:
    ok = await verify_reregister_code(get_redis(), body.email, body.code)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid or expired verification code",
        )

    # new UUID must not belong to another account
    taken = (
        await db.execute(
            select(Device).where(
                Device.device_uuid == body.new_device_uuid,
                Device.user_id != user.id,
            )
        )
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="new_device_uuid already bound to another account",
        )

    old = await _active_binding(db, user.id)
    old_uuid = old.device_uuid if old else None
    if old is not None:
        old.is_active = False

    new_device = Device(
        user_id=user.id, device_uuid=body.new_device_uuid, is_active=True
    )
    db.add(new_device)
    db.add(
        DeviceChange(
            user_id=user.id,
            old_device_uuid=old_uuid,
            new_device_uuid=body.new_device_uuid,
            verified_via="school_email",
        )
    )
    await db.commit()
    await db.refresh(new_device)
    return DeviceBinding(
        account_id=user.id,
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
