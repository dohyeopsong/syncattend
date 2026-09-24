"""
Class period (교시) time rules — fixed academic domain constants.

Rule: periods run 1..MAX_PERIOD, each PERIOD_MINUTES long, with period 1
starting at PERIOD_START_HOUR:00.

  Nth period start = 08:00 + N hours  (with PERIOD_START_HOUR=9, PERIOD_MINUTES=60)
  1교시 09:00~10:00 … 12교시 20:00~21:00

These are stable business rules (not env config), so they live here rather
than in Settings. Course.start_period/end_period reference this range.
"""
from __future__ import annotations

PERIOD_START_HOUR = 9    # 1교시 starts at 09:00
PERIOD_MINUTES = 60      # each period is 60 minutes
MIN_PERIOD = 1
MAX_PERIOD = 12          # 12교시 starts at 20:00, ends 21:00


def period_to_time(n: int) -> str:
    """Start time of the Nth period as "HH:MM" (e.g. period_to_time(1) -> "09:00").

    Raises ValueError if n is outside 1..MAX_PERIOD.
    """
    if not (MIN_PERIOD <= n <= MAX_PERIOD):
        raise ValueError(f"period must be in {MIN_PERIOD}..{MAX_PERIOD}, got {n}")
    total_minutes = (PERIOD_START_HOUR * 60) + (n - MIN_PERIOD) * PERIOD_MINUTES
    hour, minute = divmod(total_minutes, 60)
    return f"{hour:02d}:{minute:02d}"


def period_end_time(n: int) -> str:
    """End time of the Nth period as "HH:MM" (start + PERIOD_MINUTES)."""
    if not (MIN_PERIOD <= n <= MAX_PERIOD):
        raise ValueError(f"period must be in {MIN_PERIOD}..{MAX_PERIOD}, got {n}")
    total_minutes = (PERIOD_START_HOUR * 60) + (n - MIN_PERIOD) * PERIOD_MINUTES + PERIOD_MINUTES
    hour, minute = divmod(total_minutes, 60)
    return f"{hour:02d}:{minute:02d}"
