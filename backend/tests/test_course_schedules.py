"""Tests: normalized weekly course schedules (multi-slot timetable) + linking a
session to a weekly slot via schedule_id.

Covers the real-world case the schema must support:
  - Course A meets twice a week: Mon 1교시 + Tue 1교시
  - Course B meets once, 3 periods in a row: Wed 1~3교시
and that an attendance session can be tagged with which weekly slot it is.
"""
from tests.conftest import auth_header, seed_course, seed_user


async def _prof(session):
    return await seed_user(session, "p_sched@wku.ac.kr", "pw123456", "professor")


async def test_course_a_two_slots_mon_and_tue(client, session):
    prof = await _prof(session)
    course = await seed_course(session, prof.id, "A과목")
    hdr = auth_header(prof.id, "professor")

    # Mon 1교시
    r1 = await client.post(
        f"/courses/{course.id}/schedules",
        json={"day_of_week": 0, "start_period": 1, "end_period": 1},
        headers=hdr,
    )
    assert r1.status_code == 201, r1.text
    # Tue 1교시
    r2 = await client.post(
        f"/courses/{course.id}/schedules",
        json={"day_of_week": 1, "start_period": 1, "end_period": 1},
        headers=hdr,
    )
    assert r2.status_code == 201, r2.text

    listed = (await client.get(f"/courses/{course.id}/schedules", headers=hdr)).json()
    days = sorted(s["day_of_week"] for s in listed)
    assert days == [0, 1]  # Mon + Tue — a course CAN meet twice a week now


async def test_course_b_single_slot_three_periods(client, session):
    prof = await _prof(session)
    course = await seed_course(session, prof.id, "B과목")
    hdr = auth_header(prof.id, "professor")

    # Wed 1~3교시 (3 consecutive periods)
    r = await client.post(
        f"/courses/{course.id}/schedules",
        json={"day_of_week": 2, "start_period": 1, "end_period": 3},
        headers=hdr,
    )
    assert r.status_code == 201, r.text
    slot = r.json()
    assert slot["day_of_week"] == 2
    assert slot["start_period"] == 1 and slot["end_period"] == 3


async def test_duplicate_slot_rejected(client, session):
    prof = await _prof(session)
    course = await seed_course(session, prof.id, "C과목")
    hdr = auth_header(prof.id, "professor")
    body = {"day_of_week": 0, "start_period": 1, "end_period": 1}
    assert (await client.post(f"/courses/{course.id}/schedules", json=body, headers=hdr)).status_code == 201
    dup = await client.post(f"/courses/{course.id}/schedules", json=body, headers=hdr)
    assert dup.status_code == 409


async def test_inverted_period_rejected(client, session):
    prof = await _prof(session)
    course = await seed_course(session, prof.id, "D과목")
    hdr = auth_header(prof.id, "professor")
    r = await client.post(
        f"/courses/{course.id}/schedules",
        json={"day_of_week": 0, "start_period": 3, "end_period": 1},
        headers=hdr,
    )
    assert r.status_code == 422  # start > end


async def test_only_owner_professor_can_add_slot(client, session):
    prof = await _prof(session)
    course = await seed_course(session, prof.id, "E과목")
    other = await seed_user(session, "other@wku.ac.kr", "pw123456", "professor")
    hdr = auth_header(other.id, "professor")
    r = await client.post(
        f"/courses/{course.id}/schedules",
        json={"day_of_week": 0, "start_period": 1, "end_period": 1},
        headers=hdr,
    )
    assert r.status_code == 403


async def test_session_links_to_weekly_slot(client, session):
    prof = await _prof(session)
    course = await seed_course(session, prof.id, "F과목")
    hdr = auth_header(prof.id, "professor")
    # Create the Mon slot, then open a session tagged with it.
    slot_id = (
        await client.post(
            f"/courses/{course.id}/schedules",
            json={"day_of_week": 0, "start_period": 1, "end_period": 1},
            headers=hdr,
        )
    ).json()["id"]

    r = await client.post(
        "/sessions",
        json={"course_id": course.id, "week_number": 3, "schedule_id": slot_id},
        headers=hdr,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["week_number"] == 3
    assert data["schedule_id"] == slot_id  # session knows it is the Mon 회차


async def test_session_rejects_foreign_slot(client, session):
    prof = await _prof(session)
    course_a = await seed_course(session, prof.id, "G과목")
    course_b = await seed_course(session, prof.id, "H과목")
    hdr = auth_header(prof.id, "professor")
    # slot belongs to course_b
    slot_b = (
        await client.post(
            f"/courses/{course_b.id}/schedules",
            json={"day_of_week": 0, "start_period": 1, "end_period": 1},
            headers=hdr,
        )
    ).json()["id"]
    # ...but we try to open a session on course_a with course_b's slot
    r = await client.post(
        "/sessions",
        json={"course_id": course_a.id, "schedule_id": slot_b},
        headers=hdr,
    )
    assert r.status_code == 400
