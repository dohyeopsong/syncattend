"""
Isolated unit tests for the session-token service (services/tokens.py).

These exercise the Redis layer directly (via fakeredis, no server required):
  * issue_tokens sets qr / audio / pair keys with the 15s nonce TTL
  * cross_verify matches only the QR+audio pair issued together
  * consume_nonce is single-use (first True, replay False)
  * an expired / evicted pair fails cross_verify

The end-to-end suite (test_attendance_verify, test_sessions) covers the HTTP
path; this file pins the service invariants in isolation.
"""
from __future__ import annotations

import re

import pytest

from app.config import get_settings
from app.redis_client import get_redis
from app.services.tokens import (
    _audio_key,
    _pair_key,
    _qr_key,
    _used_key,
    consume_nonce,
    cross_verify,
    get_or_rotate_tokens,
    issue_tokens,
)


@pytest.fixture
def redis():
    # conftest._flush_redis (autouse) resets the fake client around each test.
    return get_redis()


async def test_issue_tokens_sets_15s_ttl_on_all_keys(redis):
    sid = "sess-ttl"
    ttl = get_settings().nonce_ttl_seconds
    assert ttl == 15  # contract: 15s rotation + TTL

    qr, audio = await issue_tokens(redis, sid)
    assert qr and audio and qr != audio

    # values persisted
    assert await redis.get(_qr_key(sid)) == qr
    assert await redis.get(_audio_key(sid)) == audio
    assert await redis.get(_pair_key(sid, qr)) == audio

    # every issued key carries the 15s TTL (0 < ttl <= 15)
    for key in (_qr_key(sid), _audio_key(sid), _pair_key(sid, qr)):
        remaining = await redis.ttl(key)
        assert 0 < remaining <= ttl, f"{key} ttl={remaining}"


_AUDIO_NONCE_RE = re.compile(r"^[0-9a-e]{8}$")


async def test_audio_nonce_is_acoustic_safe_hex(redis):
    """audio_nonce must be 8 hex nibbles from 0-e (no 'f' = start-marker slot).

    The ultrasonic transport can only carry hex nibbles and reserves slot 15
    ('f') as the START MARKER, so the issued nonce must match ^[0-9a-e]{8}$ to
    survive the emitter/decoder path whole. Sample many issues since generation
    is random.
    """
    for i in range(200):
        _qr, audio = await issue_tokens(redis, f"sess-fmt-{i}")
        assert _AUDIO_NONCE_RE.match(audio), f"non-acoustic-safe audio_nonce: {audio!r}"
        assert "f" not in audio  # explicit: 'f' collides with start marker


async def test_cross_verify_matches_only_issued_pair(redis):
    sid = "sess-x"
    qr, audio = await issue_tokens(redis, sid)

    assert await cross_verify(redis, sid, qr, audio) is True
    # wrong audio for a valid qr
    assert await cross_verify(redis, sid, qr, "not-the-audio") is False
    # unknown qr
    assert await cross_verify(redis, sid, "bogus-qr", audio) is False


async def test_consume_nonce_is_single_use(redis):
    sid = "sess-once"
    qr, _ = await issue_tokens(redis, sid)

    assert await consume_nonce(redis, sid, qr) is True   # first use
    assert await consume_nonce(redis, sid, qr) is False  # replay rejected
    assert await consume_nonce(redis, sid, qr) is False  # still rejected

    # the single-use guard key exists after consumption
    assert await redis.get(_used_key(sid, qr)) == "1"


async def test_consume_nonce_used_key_has_extended_ttl(redis):
    """Used-marker TTL outlives the nonce window so late replays stay blocked."""
    sid = "sess-usedttl"
    ttl = get_settings().nonce_ttl_seconds
    qr, _ = await issue_tokens(redis, sid)

    assert await consume_nonce(redis, sid, qr) is True
    used_ttl = await redis.ttl(_used_key(sid, qr))
    # service sets nonce_ttl * 4 so it clearly exceeds the pairing TTL
    assert used_ttl > ttl


async def test_expired_pair_fails_cross_verify(redis):
    """Once the pairing key is gone (TTL elapsed/evicted), cross_verify fails."""
    sid = "sess-exp"
    qr, audio = await issue_tokens(redis, sid)
    assert await cross_verify(redis, sid, qr, audio) is True

    # simulate TTL expiry by deleting the pairing key
    await redis.delete(_pair_key(sid, qr))
    assert await cross_verify(redis, sid, qr, audio) is False


async def test_issue_tokens_rotates_pair(redis):
    """Re-issuing produces a new pair; both remain independently cross-verifiable."""
    sid = "sess-rot"
    qr1, audio1 = await issue_tokens(redis, sid)
    qr2, audio2 = await issue_tokens(redis, sid)
    assert qr1 != qr2

    # current qr/audio reflect the latest rotation
    assert await redis.get(_qr_key(sid)) == qr2
    assert await redis.get(_audio_key(sid)) == audio2
    # both historical pairings still validate until their own TTL expires
    assert await cross_verify(redis, sid, qr1, audio1) is True
    assert await cross_verify(redis, sid, qr2, audio2) is True


async def test_get_or_rotate_tokens_reuses_until_near_expiry(redis):
    """The polling path must NOT rotate on every call: a token with plenty of
    TTL left is returned as-is (same qr, same audio, shrinking expires_in), so
    frequent polling does not shorten the ~15s rotation period."""
    sid = "sess-poll"
    ttl = get_settings().nonce_ttl_seconds

    # First call mints.
    qr1, audio1, exp1 = await get_or_rotate_tokens(redis, sid)
    assert qr1 and audio1 and exp1 == ttl

    # Immediate re-poll reuses the SAME pair (no rotation).
    qr2, audio2, exp2 = await get_or_rotate_tokens(redis, sid)
    assert qr2 == qr1
    assert audio2 == audio1
    # expires_in is the real remaining TTL, so it has ticked down a hair but
    # is still close to the full TTL.
    assert exp2 <= exp1 and exp2 > ttl - 3

    # Simulate the token nearing expiry: drop its TTL so the refresh threshold
    # trips → the next call must mint a NEW pair.
    await redis.expire(_qr_key(sid), 1)
    await redis.expire(_pair_key(sid, qr1), 1)
    qr3, audio3, exp3 = await get_or_rotate_tokens(redis, sid)
    assert qr3 != qr1
    assert audio3 != audio1
    assert exp3 == ttl  # fresh mint → full TTL


async def test_get_or_rotate_tokens_mints_when_empty(redis):
    """No current token → mint a fresh pair with the full TTL."""
    sid = "sess-empty"
    qr, audio, exp = await get_or_rotate_tokens(redis, sid)
    assert qr and audio and qr != audio
    assert exp == get_settings().nonce_ttl_seconds
    assert await cross_verify(redis, sid, qr, audio) is True
