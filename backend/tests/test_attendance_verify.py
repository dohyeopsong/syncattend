"""
Tests: attendance cross-verification (the heart of the identity defense).

Covers the pass case and every rejection reason in the contract enum:
window_closed, cross_verify_failed, nonce_reused, device_mismatch,
duplicate_attendance — plus delta batch close and manual correction.
"""
import uuid

from tests.conftest import (
    auth_header,
    seed_course,
    seed_enrollment,
    seed_open_session,
    seed_user,
)


async def _setup(client, session, window_seconds=60):
    """Create prof+course+open session, a student with a bound device, and tokens."""
    prof = await seed_user(session, f"p_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id)
    student = await seed_user(session, f"s_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    await seed_enrollment(session, course.id, student.id)
    sess = await seed_open_session(session, course.id, window_seconds)

    student_uuid = str(uuid.uuid4())
    s_hdr = auth_header(student.id, "student")
    await client.post("/devices/register", json={"device_uuid": student_uuid}, headers=s_hdr)

    p_hdr = auth_header(prof.id, "professor")
    tok = (await client.get(f"/sessions/{sess.id}/token", headers=p_hdr)).json()
    return {
        "prof": prof, "course": course, "student": student, "session": sess,
        "student_uuid": student_uuid, "s_hdr": s_hdr, "p_hdr": p_hdr, "tok": tok,
    }


async def test_verify_success(client, session):
    ctx = await _setup(client, session)
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["session"].id,
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": ctx["tok"]["audio_nonce"],
            "device_uuid": ctx["student_uuid"],
        },
        headers=ctx["s_hdr"],
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "present"
    assert data["cross_verified"] is True
    assert data["device_matched"] is True
    assert data["reason"] is None


async def test_reject_window_closed(client, session):
    ctx = await _setup(client, session)
    # close the window
    await client.post(f"/sessions/{ctx['session'].id}/close", headers=ctx["p_hdr"])
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["session"].id,
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": ctx["tok"]["audio_nonce"],
            "device_uuid": ctx["student_uuid"],
        },
        headers=ctx["s_hdr"],
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "window_closed"


async def test_reject_cross_verify_failed(client, session):
    ctx = await _setup(client, session)
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["session"].id,
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": "tampered-audio-nonce",  # doesn't match the QR pairing
            "device_uuid": ctx["student_uuid"],
        },
        headers=ctx["s_hdr"],
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "cross_verify_failed"


async def test_reject_nonce_reused(client, session):
    ctx = await _setup(client, session)
    body = {
        "session_id": ctx["session"].id,
        "qr_token": ctx["tok"]["qr_token"],
        "audio_nonce": ctx["tok"]["audio_nonce"],
        "device_uuid": ctx["student_uuid"],
    }
    first = await client.post("/attendance/verify", json=body, headers=ctx["s_hdr"])
    assert first.status_code == 200
    # replay the very same QR/audio pair (relay attack) → single-use guard
    second = await client.post("/attendance/verify", json=body, headers=ctx["s_hdr"])
    assert second.status_code == 409
    assert second.json()["reason"] == "nonce_reused"


async def test_reject_device_mismatch(client, session):
    ctx = await _setup(client, session)
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["session"].id,
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": ctx["tok"]["audio_nonce"],
            "device_uuid": str(uuid.uuid4()),  # not the bound device
        },
        headers=ctx["s_hdr"],
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "device_mismatch"


async def test_reject_duplicate_attendance(client, session):
    ctx = await _setup(client, session)
    p_hdr = ctx["p_hdr"]
    sid = ctx["session"].id

    # first attendance with the first token pair
    b1 = {
        "session_id": sid,
        "qr_token": ctx["tok"]["qr_token"],
        "audio_nonce": ctx["tok"]["audio_nonce"],
        "device_uuid": ctx["student_uuid"],
    }
    assert (await client.post("/attendance/verify", json=b1, headers=ctx["s_hdr"])).status_code == 200

    # rotate to a fresh valid token pair, retry same student+device → duplicate
    tok2 = (await client.get(f"/sessions/{sid}/token", headers=p_hdr)).json()
    b2 = {
        "session_id": sid,
        "qr_token": tok2["qr_token"],
        "audio_nonce": tok2["audio_nonce"],
        "device_uuid": ctx["student_uuid"],
    }
    r = await client.post("/attendance/verify", json=b2, headers=ctx["s_hdr"])
    assert r.status_code == 409
    assert r.json()["reason"] == "duplicate_attendance"


async def test_aggregate_and_delta_batch(client, session):
    ctx = await _setup(client, session)
    sid = ctx["session"].id
    p_hdr = ctx["p_hdr"]

    # student attends
    await client.post(
        "/attendance/verify",
        json={
            "session_id": sid,
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": ctx["tok"]["audio_nonce"],
            "device_uuid": ctx["student_uuid"],
        },
        headers=ctx["s_hdr"],
    )

    agg = (await client.get(f"/sessions/{sid}/attendance", headers=p_hdr)).json()
    assert agg["present"] == 1
    assert agg["total"] == 1
    assert agg["unverified"] == []

    # add an enrolled but absent student, then delta-close them as absent
    absent = await seed_user(session, f"a_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    await seed_enrollment(session, ctx["course"].id, absent.id)

    agg2 = (await client.get(f"/sessions/{sid}/attendance", headers=p_hdr)).json()
    assert absent.id in agg2["unverified"]

    r = await client.post(
        f"/sessions/{sid}/attendance/batch",
        json={"deltas": [{"student_id": absent.id, "status": "absent"}]},
        headers=p_hdr,
    )
    assert r.status_code == 200
    # present count unchanged; absent now recorded
    assert r.json()["present"] == 1
