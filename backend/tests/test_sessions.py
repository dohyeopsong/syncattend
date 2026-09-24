"""Tests: session create/extend/close + token issuance (professor-only)."""
from tests.conftest import auth_header, seed_course, seed_user


async def _prof_with_course(session):
    prof = await seed_user(session, "p1@wku.ac.kr", "pw123456", "professor")
    course = await seed_course(session, prof.id, "CS101")
    return prof, course


async def test_create_session_opens_window(client, session):
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post(
        "/sessions", json={"course_id": course.id, "window_seconds": 60}, headers=hdr
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["window_open"] is True
    assert 0 < data["window_remaining"] <= 60
    assert data["status"] == "open"


async def test_student_cannot_create_session(client, session):
    prof, course = await _prof_with_course(session)
    student = await seed_user(session, "st@wku.ac.kr", "pw123456", "student")
    hdr = auth_header(student.id, "student")
    r = await client.post("/sessions", json={"course_id": course.id}, headers=hdr)
    assert r.status_code == 403


async def test_close_and_extend_window(client, session):
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    sid = (
        await client.post("/sessions", json={"course_id": course.id}, headers=hdr)
    ).json()["session_id"]

    r_close = await client.post(f"/sessions/{sid}/close", headers=hdr)
    assert r_close.status_code == 200
    assert r_close.json()["window_open"] is False

    r_ext = await client.post(
        f"/sessions/{sid}/window/extend", json={"add_seconds": 30}, headers=hdr
    )
    assert r_ext.status_code == 200
    assert r_ext.json()["window_open"] is True


async def test_get_session_token(client, session):
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    sid = (
        await client.post("/sessions", json={"course_id": course.id}, headers=hdr)
    ).json()["session_id"]
    r = await client.get(f"/sessions/{sid}/token", headers=hdr)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["qr_token"] and data["audio_nonce"]
    assert data["expires_in"] == 15
