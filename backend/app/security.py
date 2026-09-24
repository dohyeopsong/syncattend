"""Security utilities: password hashing (argon2) + JWT access/refresh."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

from app.config import get_settings
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

_ph = PasswordHasher()


# ---------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# --------------------------------------------------------------------- JWT
def _encode(claims: dict[str, Any], ttl_seconds: int, token_type: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        **claims,
        "type": token_type,
        "iat": now,
        "exp": now + timedelta(seconds=ttl_seconds),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: str, role: str) -> str:
    settings = get_settings()
    return _encode(
        {"sub": user_id, "role": role},
        settings.access_token_ttl_seconds,
        "access",
    )


def create_refresh_token(user_id: str, role: str) -> str:
    settings = get_settings()
    return _encode(
        {"sub": user_id, "role": role},
        settings.refresh_token_ttl_seconds,
        "refresh",
    )


def decode_token(token: str, expected_type: str | None = None) -> dict[str, Any]:
    """Decode a JWT; raises JWTError on invalid/expired/wrong-type token."""
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if expected_type is not None and payload.get("type") != expected_type:
        raise JWTError(f"expected {expected_type} token")
    return payload
