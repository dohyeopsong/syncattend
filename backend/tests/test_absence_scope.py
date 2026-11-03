"""
Tests: absence_count is scoped per-course when a course_id is given, so the
"2~3 absences in THIS course" warning does not accidentally sum a student's
absences across every course they take.

Uses the same in-memory SQLite ORM as the rest of the suite.
"""
from datetime import timedelta

from app.models import Attendance, Session
from app.services.aggregate import absence_count
from tests.conftest import _now, seed_course, seed_user


async def _closed_session(session, course_id, week):
    now = _now()
    s = Session(
        course_id=course_id,
        week_number=week,
        status="closed",
        window_opened_at=now,
        window_expires_at=now + timedelta(seconds=60),
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


async def _absent(session, session_id, student_id):
    session.add(
        Attendance(
            session_id=session_id,
            student_id=student_id,
            device_uuid=f"delta:{student_id}",
            status="absent",
        )
    )
    await session.commit()


async def test_absence_count_is_scoped_per_course(session):
    prof = await seed_user(session, "p@wku.ac.kr", "pw123456", "professor")
    student = await seed_user(session, "s@wku.ac.kr", "pw123456", "student")
    course_a = await seed_course(session, prof.id, "자료구조")
    course_b = await seed_course(session, prof.id, "운영체제")

    # 2 absences in course A (weeks 1,2), 1 absence in course B (week 1).
    sa1 = await _closed_session(session, course_a.id, 1)
    sa2 = await _closed_session(session, course_a.id, 2)
    sb1 = await _closed_session(session, course_b.id, 1)
    await _absent(session, sa1.id, student.id)
    await _absent(session, sa2.id, student.id)
    await _absent(session, sb1.id, student.id)

    # Per-course counts are independent.
    assert await absence_count(session, student.id, course_id=course_a.id) == 2
    assert await absence_count(session, student.id, course_id=course_b.id) == 1
    # Without course_id, it sums across all courses (legacy behaviour).
    assert await absence_count(session, student.id) == 3


async def test_absence_count_ignores_present_and_pending(session):
    prof = await seed_user(session, "p2@wku.ac.kr", "pw123456", "professor")
    student = await seed_user(session, "s2@wku.ac.kr", "pw123456", "student")
    course = await seed_course(session, prof.id, "네트워크")

    s1 = await _closed_session(session, course.id, 1)
    s2 = await _closed_session(session, course.id, 2)
    # one absent, one present → only the absent one is counted
    await _absent(session, s1.id, student.id)
    session.add(
        Attendance(
            session_id=s2.id,
            student_id=student.id,
            device_uuid="dev-present",
            status="present",
            verified_at=_now(),
        )
    )
    await session.commit()

    assert await absence_count(session, student.id, course_id=course.id) == 1
