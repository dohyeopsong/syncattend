"""
End-to-end integration at the HTTP API level.

Drives the full contract flow through the ASGI app exactly as the web (C) and
mobile (B) clients would — register/login, course + enrollment, session +
rotating token, device binding, cross-verified attendance, live aggregate,
manual correction, and delta batch close. Then each of the five rejection
paths is asserted to return the correct status + reason.

Uses only real HTTP calls (no ORM shortcuts) so it exercises routing, auth,
schema (de)serialization, Redis-backed nonces (fakeredis), and DB constraints
together. This is the "does it work when wired up" check.
"""
import uuid

import pytest


# --------------------------------------------------------------------------
# helpers — thin wrappers that fail loudly with response bodies
# --------------------------------------------------------------------------
async def _register(client, email, role, password="supersecret", name=None):
    r = await client.post(
        "/auth/register",
        json={"email": email, "password": password, "role": role, "name": name},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, email, password="supersecret"):
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    body = r.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, body


@pytest.fixture
def prof_email():
    return f"prof_{uuid.uuid4().hex[:8]}@university.edu"


@pytest.fixture
def student_emails():
    return [
        f"stu1_{uuid.uuid4().hex[:8]}@wku.ac.kr",
        f"stu2_{uuid.uuid4().hex[:8]}@wku.ac.kr",
    ]


async def _bootstrap(client, prof_email, student_emails, window_seconds=120):
    """Register+login prof & 2 students, create course, enroll both, open a session."""
    await _register(client, prof_email, "professor", name="Prof")
    p_hdr, _ = await _login(client, prof_email)

    # getMe should resolve the professor's own id (contract getMe)
    me = (await client.get("/auth/me", headers=p_hdr)).json()
    assert me["role"] == "professor"

    course = (
        await client.post("/courses", json={"name": "Wiring 101"}, headers=p_hdr)
    ).json()

    students = []
    for email in student_emails:
        prof_view = await _register(client, email, "student", name="Stu")
        s_hdr, login_body = await _login(client, email)
        s_me = (await client.get("/auth/me", headers=s_hdr)).json()
        assert s_me["id"] == prof_view["id"]  # getMe id == registration id
        # enroll via professor-owned course
        enr = await client.post(
            f"/courses/{course['id']}/enrollments",
            json={"student_id": s_me["id"]},
            headers=p_hdr,
        )
        assert enr.status_code == 201, enr.text
        students.append({"hdr": s_hdr, "id": s_me["id"], "email": email})

    sess = (
        await client.post(
            "/sessions",
            json={"course_id": course["id"], "window_seconds": window_seconds},
            headers=p_hdr,
        )
    ).json()
    assert sess["window_open"] is True
    return {"p_hdr": p_hdr, "course": course, "students": students, "session": sess}


async def _token(client, p_hdr, session_id):
    r = await client.get(f"/sessions/{session_id}/token", headers=p_hdr)
    assert r.status_code == 200, r.text
    return r.json()


async def _bind_device(client, s_hdr, device_uuid):
    r = await client.post(
        "/devices/register", json={"device_uuid": device_uuid}, headers=s_hdr
    )
    assert r.status_code == 200, r.text
    return r.json()


# ==========================================================================
# HAPPY PATH — the whole contract flow, wired together
# ==========================================================================
async def test_e2e_happy_path(client, session, prof_email, student_emails):
    ctx = await _bootstrap(client, prof_email, student_emails)
    p_hdr = ctx["p_hdr"]
    sid = ctx["session"]["session_id"]
    student = ctx["students"][0]

    # student binds an app-generated device UUID
    dev = str(uuid.uuid4())
    binding = await _bind_device(client, student["hdr"], dev)
    assert binding["device_uuid"] == dev

    # professor client polls the rotating QR + audio nonce
    tok = await _token(client, p_hdr, sid)
    assert tok["expires_in"] == 15 and tok["window_open"] is True

    # student cross-verifies (window + QR×audio + nonce + device + uniqueness)
    verify = await client.post(
        "/attendance/verify",
        json={
            "session_id": sid,
            "qr_token": tok["qr_token"],
            "audio_nonce": tok["audio_nonce"],
            "device_uuid": dev,
        },
        headers=student["hdr"],
    )
    assert verify.status_code == 200, verify.text
    vbody = verify.json()
    assert vbody["status"] == "present"
    assert vbody["cross_verified"] is True and vbody["device_matched"] is True

    # professor live aggregate reflects the present student
    agg = (await client.get(f"/sessions/{sid}/attendance", headers=p_hdr)).json()
    assert agg["present"] == 1
    assert agg["total"] == 2  # two enrolled
    assert ctx["students"][1]["id"] in agg["unverified"]

    # student sees their own history via getMyAttendance
    hist = (await client.get("/me/attendance", headers=student["hdr"])).json()
    assert len(hist) == 1
    assert hist[0]["session_id"] == sid
    assert hist[0]["status"] == "present"

    # professor manually corrects the absent second student to present,
    # by locating/creating their record via a delta batch first
    absent = ctx["students"][1]
    batch = await client.post(
        f"/sessions/{sid}/attendance/batch",
        json={"deltas": [{"student_id": absent["id"], "status": "absent"}]},
        headers=p_hdr,
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["present"] == 1  # unchanged; absent recorded

    # fetch the absent record id to correct it (present)
    # re-open + verify is the normal path, but professor-in-the-loop can PATCH:
    # find record via a fresh aggregate is not enough (no ids), so correct via
    # a second delta flip to present, then verify count via aggregate.
    flip = await client.post(
        f"/sessions/{sid}/attendance/batch",
        json={"deltas": [{"student_id": absent["id"], "status": "present"}]},
        headers=p_hdr,
    )
    assert flip.status_code == 200, flip.text
    assert flip.json()["present"] == 2  # both present now

    # final close-out batch is idempotent (no further changes)
    final = await client.post(
        f"/sessions/{sid}/attendance/batch",
        json={
            "deltas": [
                {"student_id": student["id"], "status": "present"},
                {"student_id": absent["id"], "status": "present"},
            ]
        },
        headers=p_hdr,
    )
    assert final.status_code == 200, final.text
    assert final.json()["present"] == 2


async def test_e2e_correct_attendance_record(client, session, prof_email, student_emails):
    """correctAttendance (PATCH) round-trip using a real verified record id."""
    ctx = await _bootstrap(client, prof_email, student_emails)
    p_hdr = ctx["p_hdr"]
    sid = ctx["session"]["session_id"]
    student = ctx["students"][0]

    dev = str(uuid.uuid4())
    await _bind_device(client, student["hdr"], dev)
    tok = await _token(client, p_hdr, sid)
    await client.post(
        "/attendance/verify",
        json={
            "session_id": sid,
            "qr_token": tok["qr_token"],
            "audio_nonce": tok["audio_nonce"],
            "device_uuid": dev,
        },
        headers=student["hdr"],
    )
    # student history exposes the record_id we can correct
    rec = (await client.get("/me/attendance", headers=student["hdr"])).json()[0]
    record_id = rec["record_id"]

    patched = await client.patch(
        f"/attendance/{record_id}", json={"status": "absent"}, headers=p_hdr
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "absent"

    # aggregate now shows 0 present (the only present record was corrected)
    agg = (await client.get(f"/sessions/{sid}/attendance", headers=p_hdr)).json()
    assert agg["present"] == 0


# ==========================================================================
# REJECT PATHS — each returns 409 with the exact contract reason
# ==========================================================================
async def _prepare_verifiable(client, prof_email, student_emails, window_seconds=120):
    ctx = await _bootstrap(client, prof_email, student_emails, window_seconds)
    student = ctx["students"][0]
    dev = str(uuid.uuid4())
    await _bind_device(client, student["hdr"], dev)
    tok = await _token(client, ctx["p_hdr"], ctx["session"]["session_id"])
    ctx["student"] = student
    ctx["dev"] = dev
    ctx["tok"] = tok
    ctx["sid"] = ctx["session"]["session_id"]
    return ctx


async def test_e2e_reject_window_closed(client, session, prof_email, student_emails):
    ctx = await _prepare_verifiable(client, prof_email, student_emails)
    await client.post(f"/sessions/{ctx['sid']}/close", headers=ctx["p_hdr"])
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["sid"],
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": ctx["tok"]["audio_nonce"],
            "device_uuid": ctx["dev"],
        },
        headers=ctx["student"]["hdr"],
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "window_closed"


async def test_e2e_reject_cross_verify_failed(client, session, prof_email, student_emails):
    ctx = await _prepare_verifiable(client, prof_email, student_emails)
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["sid"],
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": "wrong-audio",
            "device_uuid": ctx["dev"],
        },
        headers=ctx["student"]["hdr"],
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "cross_verify_failed"


async def test_e2e_reject_nonce_reused(client, session, prof_email, student_emails):
    ctx = await _prepare_verifiable(client, prof_email, student_emails)
    body = {
        "session_id": ctx["sid"],
        "qr_token": ctx["tok"]["qr_token"],
        "audio_nonce": ctx["tok"]["audio_nonce"],
        "device_uuid": ctx["dev"],
    }
    first = await client.post("/attendance/verify", json=body, headers=ctx["student"]["hdr"])
    assert first.status_code == 200, first.text
    second = await client.post("/attendance/verify", json=body, headers=ctx["student"]["hdr"])
    assert second.status_code == 409
    assert second.json()["reason"] == "nonce_reused"


async def test_e2e_reject_device_mismatch(client, session, prof_email, student_emails):
    ctx = await _prepare_verifiable(client, prof_email, student_emails)
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["sid"],
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": ctx["tok"]["audio_nonce"],
            "device_uuid": str(uuid.uuid4()),  # not the bound device
        },
        headers=ctx["student"]["hdr"],
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "device_mismatch"


async def test_e2e_reject_duplicate_attendance(client, session, prof_email, student_emails):
    ctx = await _prepare_verifiable(client, prof_email, student_emails)
    b1 = {
        "session_id": ctx["sid"],
        "qr_token": ctx["tok"]["qr_token"],
        "audio_nonce": ctx["tok"]["audio_nonce"],
        "device_uuid": ctx["dev"],
    }
    assert (
        await client.post("/attendance/verify", json=b1, headers=ctx["student"]["hdr"])
    ).status_code == 200
    tok2 = await _token(client, ctx["p_hdr"], ctx["sid"])
    b2 = {
        "session_id": ctx["sid"],
        "qr_token": tok2["qr_token"],
        "audio_nonce": tok2["audio_nonce"],
        "device_uuid": ctx["dev"],
    }
    r = await client.post("/attendance/verify", json=b2, headers=ctx["student"]["hdr"])
    assert r.status_code == 409
    assert r.json()["reason"] == "duplicate_attendance"
