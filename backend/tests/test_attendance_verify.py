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
    assert data["status"] == "verified"
    assert data["check_phase"] == "check_in"
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


async def test_reject_duplicate_same_student_replay(client, session):
    """Same student submitting the same token twice → duplicate_attendance.

    Previously this was caught by the single-use nonce guard (nonce_reused),
    but that guard blocked ALL students after the first from scanning the same
    displayed QR. Replay by the same student is now caught by the DB-level
    UNIQUE(session_id, student_id) constraint → duplicate_attendance.
    """
    ctx = await _setup(client, session)
    body = {
        "session_id": ctx["session"].id,
        "qr_token": ctx["tok"]["qr_token"],
        "audio_nonce": ctx["tok"]["audio_nonce"],
        "device_uuid": ctx["student_uuid"],
    }
    first = await client.post("/attendance/verify", json=body, headers=ctx["s_hdr"])
    assert first.status_code == 200
    # replay the very same QR/audio pair → duplicate_attendance (not nonce_reused)
    second = await client.post("/attendance/verify", json=body, headers=ctx["s_hdr"])
    assert second.status_code == 409
    assert second.json()["reason"] == "duplicate_attendance"


async def test_multiple_students_same_token_all_pass(client, session):
    """Multiple DIFFERENT students scan the same displayed QR + hear the same
    audio → all must succeed. This is the real classroom scenario: one QR on
    the screen, 20+ students scan it. The single-use nonce guard previously
    blocked everyone after the first; it has been removed.
    """
    from tests.conftest import seed_enrollment

    ctx = await _setup(client, session)
    body = {
        "session_id": ctx["session"].id,
        "qr_token": ctx["tok"]["qr_token"],
        "audio_nonce": ctx["tok"]["audio_nonce"],
    }

    # Create 4 additional students, each enrolled + with their own device.
    extra_students = []
    for i in range(4):
        stu = await seed_user(
            session, f"multi_{i}_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student"
        )
        await seed_enrollment(session, ctx["course"].id, stu.id)
        dev_uuid = str(uuid.uuid4())
        hdr = auth_header(stu.id, "student")
        await client.post(
            "/devices/register", json={"device_uuid": dev_uuid}, headers=hdr
        )
        extra_students.append((stu, dev_uuid, hdr))

    # The original setup student goes first.
    results = []
    r = await client.post(
        "/attendance/verify",
        json={**body, "device_uuid": ctx["student_uuid"]},
        headers=ctx["s_hdr"],
    )
    results.append(r)

    # Then 4 more students — same qr_token, same audio_nonce, different devices.
    for stu, dev_uuid, hdr in extra_students:
        r = await client.post(
            "/attendance/verify",
            json={**body, "device_uuid": dev_uuid},
            headers=hdr,
        )
        results.append(r)

    # All 5 must succeed — same token, different students/devices.
    for i, r in enumerate(results):
        assert r.status_code == 200, f"student {i} failed: {r.text}"
        assert r.json()["status"] == "verified"


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

    # open the check_out window and have the student verify again, so the
    # student passes BOTH phases (→ present at close time, not early_leave).
    await client.post(f"/sessions/{sid}/checkout", json={"window_seconds": 60}, headers=p_hdr)
    tok2 = (await client.get(f"/sessions/{sid}/token", headers=p_hdr)).json()
    await client.post(
        "/attendance/verify",
        json={
            "session_id": sid,
            "qr_token": tok2["qr_token"],
            "audio_nonce": tok2["audio_nonce"],
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
    # unverified now carries readable student summaries (joined from the user);
    # the internal id is the Delta/batch key.
    assert any(u["student_id"] == absent.id for u in agg2["unverified"])

    r = await client.post(
        f"/sessions/{sid}/attendance/batch",
        json={"deltas": [{"student_id": absent.id, "status": "absent"}]},
        headers=p_hdr,
    )
    assert r.status_code == 200
    # student passed both phases → present; absent student → absent
    assert r.json()["present"] == 1
    assert r.json()["absent"] == 1


# --------------------------------------------------------------------------
# Additional coverage: 404, unregistered device, device-axis uniqueness,
# and verification-order precedence (steps run in the contract's order).
# --------------------------------------------------------------------------
async def test_verify_session_not_found(client, session):
    """Unknown session_id → 404 (before any 5-step verification)."""
    ctx = await _setup(client, session)
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": str(uuid.uuid4()),  # no such session
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": ctx["tok"]["audio_nonce"],
            "device_uuid": ctx["student_uuid"],
        },
        headers=ctx["s_hdr"],
    )
    assert r.status_code == 404, r.text


async def test_reject_device_not_registered(client, session):
    """A student with no active device binding is rejected at step (4)."""
    ctx = await _setup(client, session)
    # A different enrolled student who never registered a device.
    student2 = await seed_user(
        session, f"s2_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student"
    )
    await seed_enrollment(session, ctx["course"].id, student2.id)
    s2_hdr = auth_header(student2.id, "student")

    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["session"].id,
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": ctx["tok"]["audio_nonce"],
            "device_uuid": str(uuid.uuid4()),
        },
        headers=s2_hdr,
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "device_mismatch"


async def test_shared_device_blocked_at_registration(client, session):
    """
    One-phone-many-accounts fraud is stopped at the *registration* layer:
    a device_uuid is globally unique (one device per account), so a second
    account trying to bind an already-used UUID is rejected with 409 before it
    can ever reach attendance verification. This is the outer defense line for
    the (session, device) uniqueness guarantee.
    """
    ctx = await _setup(client, session)
    sid = ctx["session"].id

    # student #1 attends on their bound device
    b1 = {
        "session_id": sid,
        "qr_token": ctx["tok"]["qr_token"],
        "audio_nonce": ctx["tok"]["audio_nonce"],
        "device_uuid": ctx["student_uuid"],
    }
    assert (
        await client.post("/attendance/verify", json=b1, headers=ctx["s_hdr"])
    ).status_code == 200

    # student #2 attempts to bind the SAME physical device (same UUID)
    student2 = await seed_user(
        session, f"s2_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student"
    )
    await seed_enrollment(session, ctx["course"].id, student2.id)
    s2_hdr = auth_header(student2.id, "student")
    reg = await client.post(
        "/devices/register", json={"device_uuid": ctx["student_uuid"]}, headers=s2_hdr
    )
    assert reg.status_code == 409, reg.text  # UUID already bound to another account

    # With no active binding of their own, student #2 also can't verify:
    # step (4) device match fails.
    tok2 = (await client.get(f"/sessions/{sid}/token", headers=ctx["p_hdr"])).json()
    b2 = {
        "session_id": sid,
        "qr_token": tok2["qr_token"],
        "audio_nonce": tok2["audio_nonce"],
        "device_uuid": ctx["student_uuid"],
    }
    r = await client.post("/attendance/verify", json=b2, headers=s2_hdr)
    assert r.status_code == 409
    assert r.json()["reason"] == "device_mismatch"


async def test_window_precedence_over_cross_verify(client, session):
    """
    Verification runs in order: a closed window (step 1) is reported even when
    the cross-verify pair (step 2) would also fail. Guarantees stable ordering.
    """
    ctx = await _setup(client, session)
    await client.post(f"/sessions/{ctx['session'].id}/close", headers=ctx["p_hdr"])
    r = await client.post(
        "/attendance/verify",
        json={
            "session_id": ctx["session"].id,
            "qr_token": ctx["tok"]["qr_token"],
            "audio_nonce": "tampered-audio-nonce",  # would fail step 2 as well
            "device_uuid": ctx["student_uuid"],
        },
        headers=ctx["s_hdr"],
    )
    assert r.status_code == 409
    # window_closed (step 1) wins over cross_verify_failed (step 2)
    assert r.json()["reason"] == "window_closed"


# ------------------------------------------------ edge cases: correctAttendance 404
async def test_correct_attendance_record_not_found(client, session):
    """PATCH /attendance/{record_id} for a non-existent record → 404
    ('record not found'), checked before any ownership resolution."""
    ctx = await _setup(client, session)
    r = await client.patch(
        f"/attendance/{uuid.uuid4()}",
        json={"status": "present"},
        headers=ctx["p_hdr"],
    )
    assert r.status_code == 404, r.text
    assert "record not found" in r.json()["detail"].lower()


async def test_correct_attendance_existing_record_succeeds(client, session):
    """Sanity companion to the 404 case: a real record for the professor's own
    session is correctable (proves the 404 is specific to a missing target,
    not a broken happy path)."""
    ctx = await _setup(client, session)
    sid = ctx["session"].id
    # student attends → creates a real attendance record
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
    agg = (await client.get(f"/sessions/{sid}/attendance", headers=ctx["p_hdr"])).json()
    assert agg["present"] == 1
    # fetch the record id via the student's own attendance history
    my = (await client.get("/me/attendance", headers=ctx["s_hdr"])).json()
    record_id = my[0]["record_id"]
    r = await client.patch(
        f"/attendance/{record_id}",
        json={"status": "absent"},
        headers=ctx["p_hdr"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "absent"
    assert r.json()["record_id"] == record_id
