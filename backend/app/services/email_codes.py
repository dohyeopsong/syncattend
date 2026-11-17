"""
Email verification codes for signup + device re-registration.

Codes are stored in Redis with a short TTL. When RESEND_API_KEY is configured,
codes are delivered via the Resend HTTP email API (no SMTP port needed — works
on hosts like Render that block outbound SMTP). Otherwise, when SMTP_USER /
SMTP_PASSWORD are set, falls back to SMTP; with neither, logs as a dev stub.

Team member's original signup flow: send-code → verify-code → register.
Redis layout:
  signup:code:{email}      -> 6-digit code            (TTL = signup_code_ttl)
  signup:verified:{email}  -> "1" once verified       (TTL = signup_code_ttl)
  reregister:code:{email}  -> 6-digit code            (TTL = reregister_code_ttl)
"""
from __future__ import annotations

import json
import logging
import secrets
import urllib.request
from urllib.error import HTTPError

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


def _send_via_resend(to_email: str, subject: str, body: str) -> None:
    """Send an email via the Resend HTTP API.

    Uses urllib (stdlib) so no extra dependency is needed. Runs in a worker
    thread via asyncio.to_thread so the event loop is not blocked. Resend
    accepts HTTPS on port 443, which Render (and most PaaS hosts) allow even
    when outbound SMTP (465/587) is blocked.
    """
    settings = get_settings()
    api_key = (settings.resend_api_key or "").strip()
    from_address = (settings.resend_from or "").strip()
    if not from_address:
        raise RuntimeError(
            "RESEND_FROM is required when Resend delivery is enabled"
        )
    payload = json.dumps(
        {
            "from": from_address,
            "to": [to_email],
            "subject": subject,
            "text": body,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "syncattend-backend/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
    except HTTPError as exc:
        # Resend includes the actionable reason (invalid key, unverified
        # sender, restricted domain, etc.) in the JSON error body.
        detail = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(
            f"Resend HTTP {exc.code}: {detail or exc.reason}"
        ) from exc


async def _deliver(email: str, code: str, *, subject: str, body: str) -> None:
    """
    Deliver a verification code.

    Priority:
      1. RESEND_API_KEY set → Resend HTTP API (recommended for Render/etc).
      2. SMTP_USER / SMTP_PASSWORD set → SMTP (local dev / hosts that allow it).
      3. Neither → log the code as a dev stub (testable without a provider).
    """
    import asyncio

    settings = get_settings()

    # 1. Resend (preferred for hosts that block SMTP).
    if (settings.resend_api_key or "").strip():
        try:
            await asyncio.to_thread(_send_via_resend, email, subject, body)
            logger.info("verification code email sent to %s (via Resend)", email)
            return
        except Exception as e:
            logger.error("Resend delivery failed for %s: %s", email, e)
            raise

    # 2. SMTP fallback.
    if settings.smtp_user and settings.smtp_password:
        try:
            await asyncio.to_thread(_send_via_smtp, email, subject, body)
            logger.info("verification code email sent to %s (via SMTP)", email)
            return
        except Exception as e:
            logger.error("SMTP delivery failed for %s: %s", email, e)
            raise

    # 3. Dev stub.
    logger.info("verification code for %s: %s (no mail provider configured)", email, code)


def _send_via_smtp(to_email: str, subject: str, body: str) -> None:
    """SMTP fallback — synchronous, run in a worker thread."""
    import socket
    import smtplib
    from email.header import Header
    from email.mime.text import MIMEText

    settings = get_settings()
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = settings.smtp_user or ""
    msg["To"] = to_email

    # Render can resolve smtp.gmail.com to an unreachable IPv6 address.
    # Resolve an IPv4 address explicitly for the submission connection, then
    # restore the hostname before STARTTLS so certificate SNI remains correct.
    ipv4 = socket.getaddrinfo(
        settings.smtp_host,
        settings.smtp_port,
        socket.AF_INET,
        socket.SOCK_STREAM,
    )
    if not ipv4:
        raise OSError(f"no IPv4 address found for {settings.smtp_host}")
    ipv4_host = ipv4[0][4][0]

    # Port 465 uses implicit TLS from the first byte; port 587 (and other
    # submission ports) negotiate TLS with STARTTLS after the greeting.
    connect_host = settings.smtp_host if settings.smtp_port == 465 else ipv4_host
    server_factory = (
        smtplib.SMTP_SSL if settings.smtp_port == 465 else smtplib.SMTP
    )
    with server_factory(connect_host, settings.smtp_port, timeout=20) as server:
        if settings.smtp_port != 465:
            # smtplib uses _host as the TLS server_name in starttls().
            server._host = settings.smtp_host
        server.ehlo()
        if settings.smtp_port != 465:
            server.starttls()
            server.ehlo()
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(settings.smtp_user, to_email, msg.as_bytes())


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

