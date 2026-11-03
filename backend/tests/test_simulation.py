"""Tests: virtual attendance simulation endpoint.

Confirms all 5 verify cases run through the REAL verification path and each
reports the expected outcome (passed=True), and that synthetic data is cleaned
up afterwards (no sim_ users left behind).

The bot-population tests use the COURSE-scoped endpoints
(POST/DELETE /courses/{course_id}/simulate-bots). Bots enroll synchronously
(미인증) the instant they are created; present bots then wait for the session's
auth window to open and verify at delay_min=delay_max=0, so background
verification completes promptly. Tests poll the aggregate until bots land.
"""
import asyncio

from tests.conftest import auth_header, seed_course, seed_user, seed_open_session


async def _wait_for_present(client, hdr, session_id, expected, timeout=8.0):
    """Poll the session aggregate until `present` reaches `expected`, or timeout."""
    agg = {}
    for _ in range(int(timeout / 0.1)):
        agg = (
            await client.get(f"/sessions/{session_id}/attendance", headers=hdr)
        ).json()
        if agg.get("present", 0) >= expected:
            return agg
        await asyncio.sleep(0.1)
    return agg


async def _prof_course_session(session):
    prof = await seed_user(session, "p1@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "CS101")
    sess = await seed_open_session(session, course.id, window_seconds=120)
    return prof, course, sess


async def test_simulation_all_cases_pass(client, session):
    prof, course, sess = await _prof_course_session(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post(f"/sessions/{sess.id}/simulate", headers=hdr)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["session_id"] == sess.id
    assert data["cleaned_up"] is True
    names = [c["name"] for c in data["cases"]]
    assert names == ["정상 출석", "인증 창 닫힘", "QR/음향 불일치", "기기 불일치", "중복 출석"]
    # Every case must match its expected outcome.
    failed = [c["name"] for c in data["cases"] if not c["passed"]]
    assert failed == [], f"cases did not pass: {failed}"


async def test_simulation_cleans_up_synthetic_users(client, session):
    from sqlalchemy import select

    from app.models import User

    prof, course, sess = await _prof_course_session(session)
    hdr = auth_header(prof.id, "professor")
    await client.post(f"/sessions/{sess.id}/simulate", headers=hdr)
    sims = (
        await session.execute(select(User).where(User.email.like("sim_%")))
    ).scalars().all()
    assert sims == [], "synthetic sim_ users were not cleaned up"


async def test_student_cannot_simulate(client, session):
    prof, course, sess = await _prof_course_session(session)
    student = await seed_user(session, "st@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(student.id, "student")
    r = await client.post(f"/sessions/{sess.id}/simulate", headers=hdr)
    assert r.status_code == 403


# ----------------------------------------------------------- bot population
async def test_simulate_bots_enroll_before_session(client, session):
    """Bots are COURSE-scoped: creating them enrolls N 미인증 students BEFORE any
    session exists. The roster (enrollments) must reflect them immediately.
    present_ratio=0 so no background verify tasks are scheduled (the verify-
    on-session-open path is covered by the test below)."""
    prof = await seed_user(session, "p2@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "CSBOT")
    hdr = auth_header(prof.id, "professor")

    r = await client.post(
        f"/courses/{course.id}/simulate-bots",
        json={"count": 8, "present_ratio": 0.0, "delay_min": 0, "delay_max": 0},
        headers=hdr,
    )
    assert r.status_code == 200, r.text
    assert r.json()["total_bots"] == 8

    # No session yet, but the roster already shows 8 enrolled bots.
    roster = (
        await client.get(f"/courses/{course.id}/enrollments", headers=hdr)
    ).json()
    assert len(roster) == 8
    # Bot student numbers are prefixed SIMbot… so they are recognizable.
    assert all(e["student_number"].startswith("SIMbot") for e in roster)


async def test_simulate_bots_verify_on_session_open(client, session):
    """Present bots verify through the REAL path once the session's auth window
    is open. With delay=0, round(20*0.7)=14 become present; the rest stay 미인증.
    (Bots may be created before OR after the session opens — verify_bot_for_course
    waits for an open window; here the session is open first so verify lands
    promptly under the test's single-connection SQLite pool.)"""
    prof = await seed_user(session, "p3@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "CSBOT2")
    hdr = auth_header(prof.id, "professor")
    sess = await seed_open_session(session, course.id, window_seconds=120)

    r = await client.post(
        f"/courses/{course.id}/simulate-bots",
        json={"count": 20, "present_ratio": 0.7, "delay_min": 0, "delay_max": 0},
        headers=hdr,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["present"] == 14
    assert data["unverified"] == 6

    agg = await _wait_for_present(client, hdr, sess.id, 14)
    assert agg["total"] == 20
    assert agg["present"] == 14
    assert len(agg["unverified"]) == 6


async def test_simulate_bots_all_unverified(client, session):
    """present_ratio=0 → every bot stays 미인증 even with the session open."""
    prof = await seed_user(session, "p4@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "CSBOT3")
    hdr = auth_header(prof.id, "professor")
    sess = await seed_open_session(session, course.id, window_seconds=120)

    await client.post(
        f"/courses/{course.id}/simulate-bots",
        json={"count": 10, "present_ratio": 0.0, "delay_min": 0, "delay_max": 0},
        headers=hdr,
    )
    await asyncio.sleep(0.3)
    agg = (
        await client.get(f"/sessions/{sess.id}/attendance", headers=hdr)
    ).json()
    assert agg["total"] == 10
    assert agg["present"] == 0
    assert len(agg["unverified"]) == 10


async def test_cleanup_bots_removes_synthetic_data(client, session):
    from sqlalchemy import select

    from app.models import User

    prof = await seed_user(session, "p5@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "CSBOT4")
    hdr = auth_header(prof.id, "professor")
    sess = await seed_open_session(session, course.id, window_seconds=120)

    await client.post(
        f"/courses/{course.id}/simulate-bots",
        json={"count": 5, "present_ratio": 0.6, "delay_min": 0, "delay_max": 0},
        headers=hdr,
    )
    await _wait_for_present(client, hdr, sess.id, 3)

    r = await client.delete(f"/courses/{course.id}/simulate-bots", headers=hdr)
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == 5
    assert r.json()["cleaned_up"] is True

    sims = (
        await session.execute(select(User).where(User.email.like("sim_%")))
    ).scalars().all()
    assert sims == []
    # Aggregate returns to empty (no real students enrolled).
    agg = (
        await client.get(f"/sessions/{sess.id}/attendance", headers=hdr)
    ).json()
    assert agg["total"] == 0


async def test_simulate_bots_additive_no_collision(client, session):
    """Calling simulate-bots again must ADD bots, not fail on email/student_id/
    device_uuid collision. Two calls of 10 each → roster total 20 (all 미인증)."""
    prof = await seed_user(session, "p6@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "CSBOT5")
    hdr = auth_header(prof.id, "professor")

    for _ in range(2):
        r = await client.post(
            f"/courses/{course.id}/simulate-bots",
            json={"count": 10, "present_ratio": 0.0, "delay_min": 0, "delay_max": 0},
            headers=hdr,
        )
        assert r.status_code == 200, r.text

    roster = (
        await client.get(f"/courses/{course.id}/enrollments", headers=hdr)
    ).json()
    assert len(roster) == 20

    # Cleanup must remove ALL 20 bots at once.
    r = await client.delete(f"/courses/{course.id}/simulate-bots", headers=hdr)
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == 20


async def test_student_cannot_create_bots(client, session):
    prof = await seed_user(session, "p7@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "CSBOT6")
    student = await seed_user(session, "st7@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(student.id, "student")
    r = await client.post(
        f"/courses/{course.id}/simulate-bots",
        json={"count": 5, "present_ratio": 0.5, "delay_min": 0, "delay_max": 0},
        headers=hdr,
    )
    assert r.status_code == 403


async def test_simulate_bots_validates_params(client, session):
    prof, course, sess = await _prof_course_session(session)
    hdr = auth_header(prof.id, "professor")
    for bad in ({"count": 0}, {"count": 201}, {"present_ratio": 1.5}):
        r = await client.post(
            f"/courses/{course.id}/simulate-bots", json=bad, headers=hdr
        )
        assert r.status_code == 422, (bad, r.text)
