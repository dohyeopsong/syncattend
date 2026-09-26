"""
Timezone-aware datetime helpers.

Single source of truth for the tz-aware `now()` and `as_aware()` helpers that
were previously duplicated across routers/models. Behavior is unchanged: all
timestamps are UTC and naive datetimes are treated as UTC.
"""
from __future__ import annotations

from datetime import datetime, timezone


def now() -> datetime:
    """Current time as a timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


def as_aware(dt: datetime) -> datetime:
    """Return `dt` unchanged if it is tz-aware, else assume it is UTC."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
