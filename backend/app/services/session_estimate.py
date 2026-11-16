"""
Session week-number + time-slot estimation.

Given a course and "now", estimate which academic week (1..15) and which weekly
time slot (CourseSchedule row) a newly-opened session most likely belongs to.
The professor confirms/edits the estimate in the open-session modal before the
session is actually created — estimation never writes.

Week calculation:
  semester_start_date is the Monday of week 1 (per the create-course form). We
  align both `now` and `start` to their week-start (Monday) before diffing, so a
  start_date that is not itself a Monday still yields the intended week number.
  Result clamped to 1..15; outside that range (before semester / past week 15)
  returns None — the professor picks the week manually.

Slot matching:
  The current day-of-week (Mon=0..Sun=6, matching CourseSchedule.day_of_week)
  and the current period (derived from the wall clock via periods.py rules) are
  matched against the course's CourseSchedule rows. A row covers the current
  period if start_period <= current_period <= end_period. No match (보강/특강,
  evening, weekend) returns None for schedule_id — manual fallback.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Course, CourseSchedule
from app.periods import MAX_PERIOD, MIN_PERIOD, PERIOD_MINUTES, PERIOD_START_HOUR

# Week number bounds (a semester is 15 weeks).
MIN_WEEK = 1
MAX_WEEK = 15

# The school is in Korea (@wku.ac.kr); class periods and weekly slots are in
# KST. The server clock is UTC, so we convert before reading the wall clock.
KST = timezone(timedelta(hours=9))

# Korean day-of-week labels for schedule_label. Indexed by weekday() (Mon=0).
_DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]


def week_number_for(today: date, semester_start: date | None) -> int | None:
    """Academic week number (1..15) for `today` given `semester_start`.

    Returns None if semester_start is None or `today` falls outside weeks 1..15
    (before the semester starts, or past week 15).
    """
    if semester_start is None:
        return None
    # Align both dates to their Monday so the diff is in whole weeks even if the
    # start_date is not itself a Monday.
    today_mon = today - timedelta(days=today.weekday())
    start_mon = semester_start - timedelta(days=semester_start.weekday())
    delta_days = (today_mon - start_mon).days
    if delta_days < 0:
        # Before the semester starts.
        return None
    week = delta_days // 7 + 1
    if week < MIN_WEEK or week > MAX_WEEK:
        return None
    return week


def current_period(now: datetime) -> int | None:
    """The class period (1..12) whose time band contains `now`, or None.

    Period N occupies [09:00 + (N-1)h, 09:00 + N*h). Returns None before 1교시
    starts or after 12교시 ends (i.e. outside 09:00..21:00).
    """
    # Use the wall clock only; tz-awareness does not change the period.
    minutes = now.hour * 60 + now.minute
    start_minutes = PERIOD_START_HOUR * 60
    if minutes < start_minutes:
        return None
    elapsed = minutes - start_minutes
    period = elapsed // PERIOD_MINUTES + 1
    if period < MIN_PERIOD or period > MAX_PERIOD:
        return None
    return period


def schedule_label(slot: CourseSchedule) -> str:
    """Human label for a slot, e.g. '월 1교시' or '화 2~3교시'."""
    day = _DAY_LABELS[slot.day_of_week]
    if slot.start_period == slot.end_period:
        return f"{day} {slot.start_period}교시"
    return f"{day} {slot.start_period}~{slot.end_period}교시"


async def estimate_session(
    db: AsyncSession, *, course: Course, now: datetime
) -> tuple[int | None, str | None, str | None]:
    """Estimate (week_number, schedule_id, schedule_label) for a new session.

    All three can be None when estimation is impossible (no semester_start, no
    matching slot, out of semester range). The caller surfaces the estimate for
    the professor to confirm/edit before creating the session.
    """
    # Make `now` tz-aware if it came in naive (DB/loop may produce naive UTC).
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    # Convert to KST for wall-clock math: periods and weekly slots are in Korean
    # local time. Using UTC here would shift every class ~9 hours earlier (a
    # 09:00 KST 1교시 would read as 00:00 UTC → before any period → no match).
    now_local = now.astimezone(KST)

    week = week_number_for(now_local.date(), course.semester_start_date)

    period = current_period(now_local)
    today_dow = now_local.weekday()  # Mon=0..Sun=6, matches CourseSchedule.day_of_week

    slot: Optional[CourseSchedule] = None
    if period is not None:
        slot = (
            await db.execute(
                select(CourseSchedule).where(
                    CourseSchedule.course_id == course.id,
                    CourseSchedule.day_of_week == today_dow,
                    CourseSchedule.start_period <= period,
                    CourseSchedule.end_period >= period,
                )
            )
        ).scalar_one_or_none()

    schedule_id = slot.id if slot is not None else None
    label = schedule_label(slot) if slot is not None else None
    return week, schedule_id, label
