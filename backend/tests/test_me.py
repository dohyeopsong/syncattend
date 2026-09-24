"""
Tests: GET /auth/me (getMe) + GET /me/attendance (getMyAttendance).

getMe lets a client resolve its own account id/role from an access token
alone (removes the mobile SSE "me" placeholder). getMyAttendance returns the
calling student's own attendance history with course context.
"""
import uuid

from tests.conftest import (
    auth_header,
    seed_course,
    seed_enrollment,
    seed_open_session,
    seed_user,
)


# --------------------------------------------------------------------- getMe
async def test_get_me_returns_profile(client, session):
    email = f"me_{uuid.uuid4().hex[:6]}@wku.ac.kr"
    student = await seed_user(session, email, role="student", name="Han")
    r = await client.get("/auth/me", headers=auth_header(student.id, "student"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == student.id
    assert body["email"] == email
    assert body["role"] == "student"
    assert body["name"] == "Han"
    # never leak secrets
    assert "password" not in body and "password_hash" not in body


async def test_get_me_professor_role(client, session):
    prof = await seed_user(
        session, f"p_{uuid.uuid4().hex[:6]}@university.edu", role="professor"
    )
    r = await client.get("/auth/me", headers=auth_header(prof.id, "professor"))
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "professor"
    assert r.json()["id"] == prof.id


async def test_get_me_requires_auth(client, session):
    r = await client.get("/auth/me")
    assert r.status_code == 401


async def test_get_me_id_matches_login_flow(client, session):
    """The id from getMe is the one the app should use for /sse/students/{id}."""
    email = f"flow_{uuid.uuid4().hex[:6]}@wku.ac.kr"
    await client.post(
        "/auth/register",
        json={"email": email, "password": "supersecret", "role": "student"},
    )
    login = await client.post(
        "/auth/login", json={"email": email, "password": "supersecret"}
    )
    token = login.json()["access_token"]
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == email
    assert r.json()["id"]  # non-empty, usable as the SSE stream id


# ------------------------------------------------------------ getMyAttendance
async def _attend(client, session):
    """Set up a present record for one student and return context."""
    prof = await seed_user(session, f"p_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id, name="Signals 101")
    student = await seed_user(session, f"s_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    await seed_enrollment(session, course.id, student.id)
    sess = await seed_open_session(session, course.id, 60)

    student_uuid = str(uuid.uuid4())
    s_hdr = auth_header(student.id, "student")
    await client.post("/devices/register", json={"device_uuid": student_uuid}, headers=s_hdr)
    p_hdr = auth_header(prof.id, "professor")
    tok = (await client.get(f"/sessions/{sess.id}/token", headers=p_hdr)).json()
    await client.post(
        "/attendance/verify",
        json={
            "session_id": sess.id,
            "qr_token": tok["qr_token"],
            "audio_nonce": tok["audio_nonce"],
            "device_uuid": student_uuid,
        },
        headers=s_hdr,
    )
    return {"student": student, "s_hdr": s_hdr, "course": course, "session": sess}


async def test_my_attendance_lists_own_present_record(client, session):
    ctx = await _attend(client, session)
    r = await client.get("/me/attendance", headers=ctx["s_hdr"])
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    item = rows[0]
    assert item["session_id"] == ctx["session"].id
    assert item["course_id"] == ctx["course"].id
    assert item["course_name"] == "Signals 101"
    assert item["status"] == "present"
    assert item["verified_at"] is not None


async def test_my_attendance_requires_auth(client, session):
    r = await client.get("/me/attendance")
    assert r.status_code == 401


async def test_my_attendance_only_returns_own_records(client, session):
    """A different student sees none of the first student's records."""
    ctx = await _attend(client, session)
    other = await seed_user(session, f"o_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    r = await client.get("/me/attendance", headers=auth_header(other.id, "student"))
    assert r.status_code == 200, r.text
    assert r.json() == []


async def test_my_attendance_empty_when_no_records(client, session):
    student = await seed_user(session, f"n_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    r = await client.get("/me/attendance", headers=auth_header(student.id, "student"))
    assert r.status_code == 200, r.text
    assert r.json() == []
