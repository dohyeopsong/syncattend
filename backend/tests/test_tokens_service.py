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
