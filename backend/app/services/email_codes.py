"""
Email verification codes for signup + device re-registration.

Codes are stored in Redis with a short TTL. When SMTP credentials are
configured (SMTP_USER / SMTP_PASSWORD), codes are delivered via real email;
otherwise they are logged as a dev stub (so the flow is testable without a
mail provider). A production build simply sets the SMTP env vars.

Team member's original signup flow: send-code → verify-code → register.
Redis layout:
  signup:code:{email}      -> 6-digit code            (TTL = signup_code_ttl)
  signup:verified:{email}  -> "1" once verified       (TTL = signup_code_ttl)
  reregister:code:{email}  -> 6-digit code            (TTL = reregister_code_ttl)
"""
from __future__ import annotations

import logging
import secrets
import smtplib
from datetime import datetime, timezone
from email.header import Header
from email.mime.text import MIMEText

from app.config import get_settings

logger = logging.getLogger("syncattend.email")


# --------------------------------------------------------------------- keys
def _signup_code_key(email: str) -> str:
    return f"signup:code:{email.lower()}"


def _signup_verified_key(email: str) -> str:
    return f"signup:verified:{email.lower()}"


def _reregister_code_key(email: str) -> str:
    return f"reregister:code:{email.lower()}"


# ------------------------------------------------------------------ helpers
def _generate_code(length: int) -> str:
    # numeric code, zero-padded
    return f"{secrets.randbelow(10 ** length):0{length}d}"


async def _deliver(email: str, code: str, *, subject: str, body: str) -> None:
    """
    Deliver a verification code.

    If SMTP_USER / SMTP_PASSWORD are configured, send a real email via SMTP
    (team member's implementation). Otherwise, log the code as a dev stub so
    the flow remains testable without a mail provider.
    """
    settings = get_settings()
    if not settings.smtp_user or not settings.smtp_password:
        logger.info("verification code for %s: %s (SMTP not configured)", email, code)
        return

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = settings.smtp_user
    msg["To"] = email

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.smtp_user, email, msg.as_bytes())
        logger.info("verification code email sent to %s", email)
    except Exception as e:  # noqa: BLE001 — surface any SMTP failure to caller
        logger.error("SMTP delivery failed for %s: %s", email, e)
        raise


# ----------------------------------------------------------- signup flow
async def issue_signup_code(redis, email: str) -> str:
    """Generate + store + deliver a signup verification code. Returns the code."""
    settings = get_settings()
    code = _generate_code(settings.signup_code_length)
    ttl = settings.signup_code_ttl_seconds
    await redis.set(_signup_code_key(email), code, ex=ttl)
    # clear any stale verified flag when a new code is issued
    await redis.delete(_signup_verified_key(email))
    await _deliver(
        email,
        code,
        subject="[회원가입] 이메일 인증번호",
        body=f"인증번호: {code}\n\n인증번호는 {ttl // 60}분간 유효합니다.",
    )
    return code


async def verify_signup_code(redis, email: str, code: str) -> bool:
    """
    Verify a signup code. On success, mark the email as verified (consumable
    by /auth/register within the TTL). Returns False on mismatch / expiry.
    """
    settings = get_settings()
    stored = await redis.get(_signup_code_key(email))
    if stored is None:
        return False
    stored_str = stored.decode() if isinstance(stored, bytes) else str(stored)
    if secrets.compare_digest(stored_str, code):
        await redis.set(
            _signup_verified_key(email), "1", ex=settings.signup_code_ttl_seconds
        )
        # single-use: delete the code so it cannot be verified twice
        await redis.delete(_signup_code_key(email))
        return True
    return False


async def is_signup_verified(redis, email: str) -> bool:
    """True if the email completed verification and the flag is still valid."""
    flag = await redis.get(_signup_verified_key(email))
    return flag is not None


async def consume_signup_verified(redis, email: str) -> None:
    """Drop the verified flag after a successful registration."""
    await redis.delete(_signup_verified_key(email))


# --------------------------------------------------- re-registration flow
async def issue_reregister_code(redis, email: str) -> str:
    settings = get_settings()
    code = _generate_code(settings.reregister_code_length)
    await redis.set(
        _reregister_code_key(email), code, ex=settings.reregister_code_ttl_seconds
    )
    await _deliver(
        email,
        code,
        subject="[기기 재등록] 이메일 인증번호",
        body=f"인증번호: {code}\n\n인증번호는 {settings.reregister_code_ttl_seconds // 60}분간 유효합니다.",
    )
    return code


async def verify_reregister_code(redis, email: str, code: str) -> bool:
    stored = await redis.get(_reregister_code_key(email))
    if stored is None:
        return False
    stored_str = stored.decode() if isinstance(stored, bytes) else str(stored)
    if secrets.compare_digest(stored_str, code):
        await redis.delete(_reregister_code_key(email))  # single-use
        return True
    return False
