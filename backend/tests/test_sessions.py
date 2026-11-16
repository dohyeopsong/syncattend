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
    assert data["phase"] == "check_in"


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

    # extend while the check_in window is open
    r_ext = await client.post(
        f"/sessions/{sid}/window/extend", json={"add_seconds": 30}, headers=hdr
    )
    assert r_ext.status_code == 200
    assert r_ext.json()["window_open"] is True
    assert r_ext.json()["phase"] == "check_in"

    # close → window closed
    r_close = await client.post(f"/sessions/{sid}/close", headers=hdr)
    assert r_close.status_code == 200
    assert r_close.json()["window_open"] is False
    assert r_close.json()["phase"] == "closed"

    # extend after close is rejected (a closed session cannot be reopened)
    r_ext_closed = await client.post(f"/sessions/{sid}/window/extend", headers=hdr)
    assert r_ext_closed.status_code == 409


async def test_open_checkout_transitions_phase(client, session):
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    sid = (
        await client.post(
            "/sessions", json={"course_id": course.id, "window_seconds": 60}, headers=hdr
        )
    ).json()["session_id"]

    # open the check_out window
    r = await client.post(
        f"/sessions/{sid}/checkout", json={"window_seconds": 45}, headers=hdr
    )
    assert r.status_code == 200, r.text
    assert r.json()["phase"] == "check_out"
    assert r.json()["window_open"] is True
    assert 0 < r.json()["window_remaining"] <= 45
    assert r.json()["checkout_opened"] is True

    # opening checkout twice (while check_out is the active phase) is rejected
    r2 = await client.post(f"/sessions/{sid}/checkout", headers=hdr)
    assert r2.status_code == 409

    # checkout on a NEWLY closed session (1차 only) is ALLOWED — the professor
    # closes 1차, reviews absentees, then re-opens the SAME session for 2차.
    sid2 = (
        await client.post("/sessions", json={"course_id": course.id}, headers=hdr)
    ).json()["session_id"]
    await client.post(f"/sessions/{sid2}/close", headers=hdr)
    r3 = await client.post(f"/sessions/{sid2}/checkout", headers=hdr)
    assert r3.status_code == 200, r3.text
    assert r3.json()["phase"] == "check_out"
    assert r3.json()["checkout_opened"] is True


async def test_checkout_reopen_after_close_keeps_attendance(client, session):
    """The intended 2-phase flow: 1차 인증 → 닫기 → 2차 재오픈. The SAME session
    is re-opened for check_out so attendance aggregation stays intact (the final
    status derives from the two phase timestamps on one Attendance row)."""
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    sid = (
        await client.post(
            "/sessions", json={"course_id": course.id, "window_seconds": 60}, headers=hdr
        )
    ).json()["session_id"]
    # 1차 (check_in) is open initially; close it without opening checkout.
    assert (await client.post(f"/sessions/{sid}/close", headers=hdr)).status_code == 200
    closed = (await client.post(f"/sessions/{sid}/close", headers=hdr))
    # closing an already-closed session is a no-op (still 200, phase closed).
    assert closed.json()["phase"] == "closed"
    assert closed.json()["checkout_opened"] is False

    # Re-open the SAME session for 2차 (check_out) — allowed from closed.
    r = await client.post(f"/sessions/{sid}/checkout", headers=hdr)
    assert r.status_code == 200, r.text
    assert r.json()["phase"] == "check_out"
    assert r.json()["window_open"] is True
    assert r.json()["checkout_opened"] is True


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


async def test_get_token_rejected_after_close(client, session):
    """A closed session must NOT issue tokens — the round is over and the QR/
    audio nonce must stop rotating so students can't verify against a finished
    session."""
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    sid = (
        await client.post("/sessions", json={"course_id": course.id}, headers=hdr)
    ).json()["session_id"]
    # Token works while the session is open.
    assert (await client.get(f"/sessions/{sid}/token", headers=hdr)).status_code == 200
    # Close → token endpoint must 409.
    await client.post(f"/sessions/{sid}/close", headers=hdr)
    r = await client.get(f"/sessions/{sid}/token", headers=hdr)
    assert r.status_code == 409


async def test_create_session_with_week_number(client, session):
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post(
        "/sessions",
        json={"course_id": course.id, "window_seconds": 60, "week_number": 3},
        headers=hdr,
    )
    assert r.status_code == 201, r.text
    assert r.json()["week_number"] == 3


async def test_create_session_without_week_number_is_null(client, session):
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    r = await client.post("/sessions", json={"course_id": course.id}, headers=hdr)
    assert r.status_code == 201, r.text
    assert r.json()["week_number"] is None


async def test_week_number_out_of_range_rejected(client, session):
    prof, course = await _prof_with_course(session)
    hdr = auth_header(prof.id, "professor")
    for bad in (0, 16, -1):
        r = await client.post(
            "/sessions",
            json={"course_id": course.id, "week_number": bad},
            headers=hdr,
        )
        assert r.status_code == 422, (bad, r.text)
