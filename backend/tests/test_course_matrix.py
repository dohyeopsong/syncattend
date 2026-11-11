"""
Tests: GET /courses/{course_id}/attendance/matrix — the cumulative per-student
x per-week attendance matrix that powers the web's F-grade risk panel.

Covers: closed-session derivation (present/late/early_leave/absent from the two
timestamps), open-session derivation (present if current phase passed, else
pending), null for weeks with no session, worst-status combination when a week
has multiple sessions, and ownership/403.
"""
from datetime import timedelta

from app.models import Attendance, Session
from tests.conftest import (
    _now,
    auth_header,
    seed_course,
    seed_enrollment,
    seed_user,
)


async def _session(session, course_id, week, phase="closed"):
    now = _now()
    s = Session(
        course_id=course_id,
        week_number=week,
        phase=phase,
        window_opened_at=now,
        window_expires_at=now + timedelta(seconds=60),
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


async def _att(session, session_id, student_id, *, status="pending",
               check_in=None, check_out=None):
    session.add(
        Attendance(
            session_id=session_id,
            student_id=student_id,
            device_uuid=f"dev:{student_id}",
            status=status,
            check_in_verified_at=check_in,
            check_out_verified_at=check_out,
        )
    )
    await session.commit()


def _find(students, student_id):
    return next(s for s in students if s["student_id"] == student_id)


async def test_matrix_derives_closed_and_open_statuses(client, session):
    prof = await seed_user(session, "p@wku.ac.kr", "pw123456", "professor")
    a = await seed_user(session, "a@wku.ac.kr", "pw123456", "student", name="A")
    b = await seed_user(session, "b@wku.ac.kr", "pw123456", "student", name="B")
    a.student_id = "20240001"
    b.student_id = "20240002"
    await session.commit()
    course = await seed_course(session, prof.id, "자료구조")
    await seed_enrollment(session, course.id, a.id)
    await seed_enrollment(session, course.id, b.id)

    # Week 1: closed session. A present (both stamps), B absent (no record).
    w1 = await _session(session, course.id, 1, phase="closed")
    await _att(session, w1.id, a.id, status="pending",
               check_in=_now(), check_out=_now())
    # B has no record -> absent at close.

    # Week 2: open (check_in) session. A passed check_in -> present; B no record -> pending.
    w2 = await _session(session, course.id, 2, phase="check_in")
    await _att(session, w2.id, a.id, status="pending", check_in=_now())

    r = await client.get(
        f"/courses/{course.id}/attendance/matrix",
        headers=auth_header(prof.id, "professor"),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["course_id"] == course.id
    assert body["course_name"] == "자료구조"
    assert body["weeks"] == [1, 2]

    row_a = _find(body["students"], a.id)
    row_b = _find(body["students"], b.id)
    # 15 columns; weeks 3..15 are null (no session).
    assert len(row_a["weeks"]) == 15
    assert row_a["weeks"] == ["present", "present"] + [None] * 13
    assert row_b["weeks"] == ["absent", "pending"] + [None] * 13


async def test_matrix_closed_late_and_early_leave(client, session):
    prof = await seed_user(session, "p2@wku.ac.kr", "pw123456", "professor")
    late = await seed_user(session, "l@wku.ac.kr", "pw123456", "student", name="L")
    early = await seed_user(session, "e@wku.ac.kr", "pw123456", "student", name="E")
    late.student_id = "20240010"
    early.student_id = "20240011"
    await session.commit()
    course = await seed_course(session, prof.id, "운영체제")
    await seed_enrollment(session, course.id, late.id)
    await seed_enrollment(session, course.id, early.id)

    w1 = await _session(session, course.id, 1, phase="closed")
    # late: check_out only -> late; early_leave: check_in only -> early_leave
    await _att(session, w1.id, late.id, status="pending", check_out=_now())
    await _att(session, w1.id, early.id, status="pending", check_in=_now())

    r = await client.get(
        f"/courses/{course.id}/attendance/matrix",
        headers=auth_header(prof.id, "professor"),
    )
    assert r.status_code == 200
    row_late = _find(r.json()["students"], late.id)
    row_early = _find(r.json()["students"], early.id)
    assert row_late["weeks"][0] == "late"
    assert row_early["weeks"][0] == "early_leave"


async def test_matrix_combines_multiple_sessions_per_week_worst_wins(client, session):
    prof = await seed_user(session, "p3@wku.ac.kr", "pw123456", "professor")
    stu = await seed_user(session, "s3@wku.ac.kr", "pw123456", "student", name="S")
    stu.student_id = "20240020"
    await session.commit()
    course = await seed_course(session, prof.id, "데이터베이스")
    await seed_enrollment(session, course.id, stu.id)

    # Two closed sessions in week 1: present in one, absent in the other.
    w1a = await _session(session, course.id, 1, phase="closed")
    w1b = await _session(session, course.id, 1, phase="closed")
    await _att(session, w1a.id, stu.id, status="pending",
               check_in=_now(), check_out=_now())  # present
    await _att(session, w1b.id, stu.id, status="pending")  # neither -> absent

    r = await client.get(
        f"/courses/{course.id}/attendance/matrix",
        headers=auth_header(prof.id, "professor"),
    )
    assert r.status_code == 200
    row = _find(r.json()["students"], stu.id)
    # Worst of {present, absent} = absent.
    assert row["weeks"][0] == "absent"


async def test_matrix_excludes_null_week_sessions(client, session):
    prof = await seed_user(session, "p4@wku.ac.kr", "pw123456", "professor")
    stu = await seed_user(session, "s4@wku.ac.kr", "pw123456", "student", name="S4")
    course = await seed_course(session, prof.id, "알고리즘")
    await seed_enrollment(session, course.id, stu.id)

    # A legacy session with no week_number — must NOT appear in the 15-week grid.
    now = _now()
    session.add(Session(
        course_id=course.id, week_number=None, phase="closed",
        window_opened_at=now, window_expires_at=now + timedelta(seconds=60),
    ))
    await session.commit()

    r = await client.get(
        f"/courses/{course.id}/attendance/matrix",
        headers=auth_header(prof.id, "professor"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["weeks"] == []  # no weeked sessions
    row = _find(body["students"], stu.id)
    assert row["weeks"] == [None] * 15


async def test_matrix_requires_course_owner(client, session):
    prof = await seed_user(session, "p5@wku.ac.kr", "pw123456", "professor")
    other = await seed_user(session, "o5@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "컴파일러")

    r = await client.get(
        f"/courses/{course.id}/attendance/matrix",
        headers=auth_header(other.id, "professor"),
    )
    assert r.status_code == 403


async def test_matrix_empty_course(client, session):
    prof = await seed_user(session, "p6@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "빈강의")

    r = await client.get(
        f"/courses/{course.id}/attendance/matrix",
        headers=auth_header(prof.id, "professor"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["students"] == []
    assert body["weeks"] == []
