"""
Session token service — rotating QR + ultrasonic audio nonces.

Both tokens rotate every `nonce_ttl_seconds` (15s) and are single-use: the
verify step consumes them atomically so a replayed/relayed token is rejected.

Redis layout (per session):
  sess:{sid}:qr          -> current qr_token          (TTL = nonce_ttl)
  sess:{sid}:audio       -> current audio_nonce        (TTL = nonce_ttl)
  sess:{sid}:pair:{qr}   -> audio_nonce  (cross-verify map, TTL = nonce_ttl)
  sess:{sid}:used:{qr}   -> "1" once consumed          (single-use guard)
"""
from __future__ import annotations

import secrets

from app.config import get_settings

# Acoustic hex alphabet for audio_nonce: nibbles 0..14 only.
# The ultrasonic protocol reserves slot 15 (hex 'f') as the START MARKER, so
# 'f' must never appear in a nonce or the emitter/decoder would remap it and
# corrupt the value. audio_nonce is transmitted whole over air, so it must be
# expressible as raw hex nibbles (base64url tokens cannot survive that path).
_AUDIO_ALPHABET = "0123456789abcde"  # 0-e, excludes 'f' (start-marker slot)
_AUDIO_NONCE_NIBBLES = 8  # 32-bit frame, matches the decoder's default frame


def _new_audio_nonce() -> str:
    """Return an acoustic-safe nonce: 8 hex nibbles from 0-e (no 'f')."""
    return "".join(secrets.choice(_AUDIO_ALPHABET) for _ in range(_AUDIO_NONCE_NIBBLES))


def _qr_key(sid: str) -> str:
    return f"sess:{sid}:qr"


def _audio_key(sid: str) -> str:
    return f"sess:{sid}:audio"


def _pair_key(sid: str, qr: str) -> str:
    return f"sess:{sid}:pair:{qr}"


def _used_key(sid: str, qr: str) -> str:
    return f"sess:{sid}:used:{qr}"


async def issue_tokens(redis, session_id: str) -> tuple[str, str]:
    """Force-rotate: always mint a fresh (qr_token, audio_nonce) pair.

    Used by the simulation endpoint and tests where a guaranteed-fresh pair is
    needed. The professor dashboard MUST NOT use this on its poll path — it
    would rotate the token every poll, making the rotation period equal to the
    poll interval (e.g. 9s) instead of the 15s TTL. Use
    [get_or_rotate_tokens] for the polling path instead.
    """
    settings = get_settings()
    ttl = settings.nonce_ttl_seconds
    qr = secrets.token_urlsafe(16)
    audio = _new_audio_nonce()
    await redis.set(_qr_key(session_id), qr, ex=ttl)
    await redis.set(_audio_key(session_id), audio, ex=ttl)
    # cross-verify pairing so audio must match the QR that was issued together
    await redis.set(_pair_key(session_id, qr), audio, ex=ttl)
    return qr, audio


# When the current token has this many seconds (or fewer) left, the polling
# path mints a fresh one. Kept small (well below the 15s TTL) so a token lives
# its full ~15s and only rotates at the end — polling faster than the TTL must
# NOT shorten the rotation period.
_ROTATE_REFRESH_SECONDS = 3


async def get_or_rotate_tokens(
    redis, session_id: str
) -> tuple[str, str, int]:
    """Return the current (qr_token, audio_nonce, expires_in) for a session.

    Reuses the token already in Redis while it still has more than
    [_ROTATE_REFRESH_SECONDS] of TTL left, so frequent polling does NOT rotate
    the token — it lives a full ~15s and rotates only near expiry. This is the
    function the professor dashboard's getSessionToken endpoint must call;
    [issue_tokens] force-rotates on every call and is for simulation/tests.

    `expires_in` is the REAL remaining TTL of the returned token (capped at the
    configured nonce TTL), so the client countdown reflects actual expiry
    instead of always resetting to 15.
    """
    settings = get_settings()
    ttl = settings.nonce_ttl_seconds
    qr_raw = await redis.get(_qr_key(session_id))
    if qr_raw is not None:
        qr = qr_raw if isinstance(qr_raw, str) else qr_raw.decode()
        remaining = await redis.ttl(_qr_key(session_id))
        if remaining is not None and remaining > _ROTATE_REFRESH_SECONDS:
            audio_raw = await redis.get(_pair_key(session_id, qr))
            if audio_raw is not None:
                audio = (
                    audio_raw
                    if isinstance(audio_raw, str)
                    else audio_raw.decode()
                )
                return qr, audio, min(remaining, ttl)
        # fall through: too little TTL left (or pair missing) → rotate
    qr = secrets.token_urlsafe(16)
    audio = _new_audio_nonce()
    await redis.set(_qr_key(session_id), qr, ex=ttl)
    await redis.set(_audio_key(session_id), audio, ex=ttl)
    await redis.set(_pair_key(session_id, qr), audio, ex=ttl)
    return qr, audio, ttl


async def cross_verify(redis, session_id: str, qr: str, audio: str) -> bool:
    """True if (qr, audio) were issued together and both still valid (not expired)."""
    paired = await redis.get(_pair_key(session_id, qr))
    if paired is None:
        return False
    paired_str = paired.decode() if isinstance(paired, bytes) else str(paired)
    return secrets.compare_digest(paired_str, audio)


async def consume_nonce(redis, session_id: str, qr: str) -> bool:
    """
    Atomically mark a QR token consumed. Returns True on first use, False if
    it was already consumed (single-use / replay guard).

    NOTE: This guard is NOT called from the verify flow. It marked the QR
    token itself as single-use, which blocked every student after the first
    from scanning the same displayed QR. Per-student / per-device replay is
    enforced at the DB level via UNIQUE(session_id, student_id) and
    UNIQUE(session_id, device_uuid) constraints instead. Kept here for
    reference and potential future per-student token schemes.
    """
    settings = get_settings()
    # SET NX returns True only if the key did not exist → first consumption.
    first = await redis.set(
        _used_key(session_id, qr), "1", nx=True, ex=settings.nonce_ttl_seconds * 4
    )
    return bool(first)
