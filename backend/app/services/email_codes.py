"""
Device re-registration email verification codes.

Codes are stored in Redis with a short TTL. In dev/test the code is returned
to the caller (and logged) instead of sending a real email; a production build
would swap `_deliver` for an SMTP/provider call.
"""
from __future__ import annotations

import logging
import secrets

from app.config import get_settings

logger = logging.getLogger("syncattend.email")


def _code_key(email: str) -> str:
    return f"reregister:code:{email.lower()}"


def _generate_code(length: int) -> str:
    # numeric code, zero-padded
    return f"{secrets.randbelow(10 ** length):0{length}d}"


async def _deliver(email: str, code: str) -> None:
    # Stub: real implementation would send via SMTP/provider.
    logger.info("re-registration code for %s: %s", email, code)


async def issue_reregister_code(redis, email: str) -> str:
    settings = get_settings()
    code = _generate_code(settings.reregister_code_length)
    await redis.set(
        _code_key(email), code, ex=settings.reregister_code_ttl_seconds
    )
    await _deliver(email, code)
    return code


async def verify_reregister_code(redis, email: str, code: str) -> bool:
    stored = await redis.get(_code_key(email))
    if stored is None:
        return False
    stored_str = stored.decode() if isinstance(stored, bytes) else str(stored)
    if secrets.compare_digest(stored_str, code):
        await redis.delete(_code_key(email))  # single-use
        return True
    return False
