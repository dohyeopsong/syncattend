"""Tests: session week/slot estimation (estimateSession + helpers).

Covers the pure helpers (week_number_for, current_period, schedule_label) with
fixed dates for determinism, and the estimateSession endpoint end-to-end.
"""
from datetime import datetime, timezone
from types import SimpleNamespace

from tests.conftest import auth_header, seed_course, seed_user
from app.services.session_estimate import (
    KST,
    current_period,
    schedule_label,
    week_number_for,
)


# --------------------------------------------------------- week_number_for
def test_week_number_for_mid_semester():
    # Semester starts Mon 2026-09-07. Wed 2026-09-23 is in week 3.
    start = __import__("datetime").date(2026, 9, 7)
    today = __import__("datetime").date(2026, 9, 23)
    assert week_number_for(today, start) == 3


def test_week_number_for_first_day():
    start = __import__("datetime").date(2026, 9, 7)
    # The start date itself is week 1.
    assert week_number_for(start, start) == 1


def test_week_number_for_before_semester_returns_none():
    start = __import__("datetime").date(2026, 9, 7)
    before = __import__("datetime").date(2026, 9, 5)  # Saturday before
    assert week_number_for(before, start) is None


def test_week_number_for_past_week_15_returns_none():
    start = __import__("datetime").date(2026, 9, 7)
    # Week 16 Monday = start + 15 weeks = 2026-12-21.
    week16 = __import__("datetime").date(2026, 12, 21)
    assert week_number_for(week16, start) is None


def test_week_number_for_week_15_boundary():
    start = __import__("datetime").date(2026, 9, 7)
    # Week 15 Friday = start + 14 weeks + 4 days = 2026-12-18.
    week15 = __import__("datetime").date(2026, 12, 18)
    assert week_number_for(week15, start) == 15


def test_week_number_for_no_start_date_returns_none():
    today = __import__("datetime").date(2026, 11, 12)
    assert week_number_for(today, None) is None


# ----------------------------------------------------------- current_period
def test_current_period_within_range():
    # 10:30 on a Monday -> period 2 (10:00-11:00).
    now = datetime(2026, 11, 9, 10, 30, tzinfo=timezone.utc)
    assert current_period(now) == 2


def test_current_period_first_period_start():
    # 09:00 sharp -> period 1.
    now = datetime(2026, 11, 9, 9, 0, tzinfo=timezone.utc)
    assert current_period(now) == 1


def test_current_period_before_first_returns_none():
    # 08:59 -> before 1교시.
    now = datetime(2026, 11, 9, 8, 59, tzinfo=timezone.utc)
    assert current_period(now) is None


def test_current_period_after_last_returns_none():
    # 21:00 sharp -> 12교시 ended (20:00-21:00), so 21:00 is past.
    now = datetime(2026, 11, 9, 21, 0, tzinfo=timezone.utc)
    assert current_period(now) is None


# ----------------------------------------------------------- schedule_label
def test_schedule_label_single_period():
    slot = SimpleNamespace(day_of_week=0, start_period=1, end_period=1)
    assert schedule_label(slot) == "월 1교시"


def test_schedule_label_multi_period():
    slot = SimpleNamespace(day_of_week=1, start_period=2, end_period=3)
    assert schedule_label(slot) == "화 2~3교시"


def test_schedule_label_all_days():
    expected = ["월", "화", "수", "목", "금", "토", "일"]
    for dow, label in enumerate(expected):
        slot = SimpleNamespace(day_of_week=dow, start_period=1, end_period=1)
        assert schedule_label(slot).startswith(label)


# --------------------------------------------------- estimateSession endpoint
async def test_estimate_returns_week_and_slot(client, session):
    """With a semester_start_date and a matching weekly slot, estimate returns
    both the week number and the slot id + label for the current time."""
    from datetime import date, timedelta

    prof = await seed_user(session, "p.est@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id, "추정강의")
    # Set semester start to ~10 weeks ago so the current date is mid-semester.
    today = date.today()
    start = today - timedelta(days=70)
    course.semester_start_date = start
    await session.commit()

    # Add a slot for today's day-of-week spanning the current period.
    from app.models import CourseSchedule

    now = datetime.now(KST)
    cur_period = current_period(now)
    if cur_period is None:
        # If the test runs outside 09:00-21:00 KST, synthesize a slot that
        # won't match the current time -> schedule_id should be None but week set.
        cur_period = 1
    slot = CourseSchedule(
        course_id=course.id,
        day_of_week=now.weekday(),
        start_period=cur_period,
        end_period=cur_period,
    )
    session.add(slot)
    await session.commit()
    await session.refresh(slot)

    hdr = auth_header(prof.id, "professor")
    r = await client.post(
        "/sessions/estimate", json={"course_id": course.id}, headers=hdr
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["week_number"] is not None
    assert 1 <= body["week_number"] <= 15
    # The slot we added matches the current time, so it should be returned.
    assert body["schedule_id"] == slot.id
    assert body["schedule_label"] is not None


async def test_estimate_no_semester_start_returns_nulls(client, session):
    """A course with no semester_start_date returns null week_number (manual
    fallback) — estimation is impossible."""
    prof = await seed_user(session, "p.est2@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id, "무기준강의")
    # semester_start_date is NULL by default (seed_course doesn't set it).

    hdr = auth_header(prof.id, "professor")
    r = await client.post(
        "/sessions/estimate", json={"course_id": course.id}, headers=hdr
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["week_number"] is None
    assert body["schedule_id"] is None
    assert body["schedule_label"] is None


async def test_estimate_student_forbidden(client, session):
    """Estimation is professor-only — a student gets 403."""
    prof = await seed_user(session, "p.est3@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id, "권한강의")
    student = await seed_user(session, "s.est3@wku.ac.kr", role="student")

    hdr = auth_header(student.id, "student")
    r = await client.post(
        "/sessions/estimate", json={"course_id": course.id}, headers=hdr
    )
    assert r.status_code == 403


async def test_estimate_not_your_course_forbidden(client, session):
    """A professor cannot estimate for another professor's course."""
    prof_a = await seed_user(session, "pa@wku.ac.kr", role="professor")
    prof_b = await seed_user(session, "pb@wku.ac.kr", role="professor")
    course = await seed_course(session, prof_a.id, "다른교수강의")

    hdr = auth_header(prof_b.id, "professor")
    r = await client.post(
        "/sessions/estimate", json={"course_id": course.id}, headers=hdr
    )
    assert r.status_code == 403
