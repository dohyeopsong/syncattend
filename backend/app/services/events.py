"""
Redis pub/sub for attendance change notifications.

Replaces the old 2-second SSE DB-polling loop: instead of every connected SSE
stream querying the DB on a timer, the endpoints that mutate attendance
(verify, batchClose, correct) publish a cheap notification, and the SSE
generators block on a Redis subscription — waking only when something actually
changed. A short fallback poll remains as a safety net in case a publish is
missed (Redis eviction, network blip), but the steady-state DB load drops from
"queries every 2s per stream" to "queries only on real change".

Channels:
  ch:session:{session_id}  — session attendance changed → professor SSE
  ch:student:{student_id}  — student's absence count may have changed → student SSE

Messages are tiny markers ("1"); the subscriber re-queries the DB to build the
fresh aggregate only when woken. This keeps the publish path O(1) and avoids
serializing the full payload twice (once for the response, once for the stream).
"""
from __future__ import annotations

import asyncio
import logging

from app.redis_client import get_redis

logger = logging.getLogger("syncattend.events")

_SESSION_CHANNEL = "ch:session:{sid}"
_STUDENT_CHANNEL = "ch:student:{uid}"

# Safety-net fallback: even with no pub/sub message, re-check this often so a
# missed publish (Redis eviction etc.) can't freeze the stream indefinitely.
# Far cheaper than the old 2s poll because it only re-queries on wake, and the
# publish path means it almost always wakes from the subscription, not the timer.
_FALLBACK_SECONDS = 15.0


def session_channel(session_id: str) -> str:
    return _SESSION_CHANNEL.format(sid=session_id)


def student_channel(student_id: str) -> str:
    return _STUDENT_CHANNEL.format(uid=student_id)


async def notify_session_changed(session_id: str) -> None:
    """Publish a session-attendance-changed notification (best-effort)."""
    try:
        redis = get_redis()
        await redis.publish(session_channel(session_id), "1")
    except Exception:
        # Pub/sub is an optimization, not a correctness mechanism. A failed
        # publish just means the SSE stream wakes on the fallback timer instead.
        logger.debug("session publish failed for %s", session_id, exc_info=True)


async def notify_student_changed(student_id: str) -> None:
    """Publish a student-absence-may-have-changed notification (best-effort)."""
    try:
        redis = get_redis()
        await redis.publish(student_channel(student_id), "1")
    except Exception:
        logger.debug("student publish failed for %s", student_id, exc_info=True)


async def wait_for_change(
    channel: str,
    *,
    fallback_seconds: float = _FALLBACK_SECONDS,
) -> None:
    """Block until a message arrives on `channel` or the fallback timer fires.

    Uses a Redis pub/sub subscription. The fallback timer ensures the caller
    re-checks the DB periodically even if no message arrives, so a missed
    publish can't stall the stream.
    """
    redis = get_redis()
    # fakeredis and redis.asyncio both expose pubsub(); the interface is the
    # same. We subscribe, then race get_message against the fallback timer.
    pubsub = redis.pubsub()
    try:
        await pubsub.subscribe(channel)
        deadline = asyncio.get_event_loop().time() + fallback_seconds
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                return  # fallback timeout → caller re-queries
            # get_message with a timeout so we don't block forever; the loop
            # re-checks the deadline each iteration.
            msg = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=remaining,
            )
            if msg is not None:
                return  # real change notification → caller re-queries
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception:
            logger.debug("pubsub cleanup failed for %s", channel, exc_info=True)
