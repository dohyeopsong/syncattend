"""
Async Redis client provider.

Uses a real Redis by default; when REDIS_URL starts with 'fakeredis' (tests),
an in-memory fakeredis instance is used instead so the suite runs without a
running Redis server.
"""
from __future__ import annotations

from typing import Any

from app.config import get_settings

_client: Any | None = None


def get_redis() -> Any:
    """Return a shared async Redis client (redis.asyncio.Redis-compatible)."""
    global _client
    if _client is None:
        settings = get_settings()
        if settings.use_fake_redis:
            import fakeredis.aioredis as fakeredis

            _client = fakeredis.FakeRedis(decode_responses=True)
        else:
            import redis.asyncio as aioredis

            _client = aioredis.from_url(
                settings.redis_url, decode_responses=True
            )
    return _client


async def reset_redis() -> None:
    """Test helper: flush and drop the cached client."""
    global _client
    if _client is not None:
        try:
            await _client.flushall()
        finally:
            _client = None
