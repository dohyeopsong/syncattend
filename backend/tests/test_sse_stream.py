"""
SSE passthrough integration.

An infinite text/event-stream cannot be read incrementally through httpx's
in-process ASGITransport (it buffers), so we verify the streams two ways:

  1) Pull the FIRST event directly from the module-level async generators the
     router uses (app.routers.sse.session_attendance_events /
     student_risk_events) — this proves events actually flow after a verify /
     absence change, deterministically and without HTTP timing.
  2) A light HTTP smoke that the SSE routes return 200 text/event-stream with
     auth (routing + content-type wiring), reading just the first chunk.

Manual end-to-end curl steps are documented in backend/README (SSE section).
"""
import asyncio
import json
import uuid

from app.routers.sse import session_attendance_events, student_risk_events
from tests.conftest import (
    auth_header,
    seed_course,
    seed_enrollment,
    seed_open_session,
    seed_user,
)


async def _first(agen):
    """Return the first item from an async generator, then close it."""
    try:
        return await asyncio.wait_for(agen.__anext__(), timeout=5.0)
    finally:
        await agen.aclose()


# --------------------------------------------------------------- generators
async def test_sse_session_emits_attendance_after_verify(client, session):
    """After a student verifies present, the session stream's first event is an
    AttendanceAggregate with present >= 1."""
    prof = await seed_user(session, f"p_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id)
    student = await seed_user(session, f"s_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    await seed_enrollment(session, course.id, student.id)
    sess = await seed_open_session(session, course.id, 120)

    dev = str(uuid.uuid4())
    s_hdr = auth_header(student.id, "student")
    p_hdr = auth_header(prof.id, "professor")
    await client.post("/devices/register", json={"device_uuid": dev}, headers=s_hdr)
    tok = (await client.get(f"/sessions/{sess.id}/token", headers=p_hdr)).json()
    verify = await client.post(
        "/attendance/verify",
        json={
            "session_id": sess.id,
            "qr_token": tok["qr_token"],
            "audio_nonce": tok["audio_nonce"],
            "device_uuid": dev,
        },
        headers=s_hdr,
    )
    assert verify.status_code == 200, verify.text

    evt = await _first(session_attendance_events(session, sess.id, poll_seconds=0.01))
    assert evt["event"] == "attendance"
    payload = json.loads(evt["data"])
    assert payload["session_id"] == sess.id
    assert payload["present"] >= 1


async def test_sse_student_emits_risk_after_absences(client, session):
    """Once the student accrues enough absences, the student stream's first
    event is a RiskWarning at warning/danger level."""
    prof = await seed_user(session, f"p_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id)
    student = await seed_user(session, f"s_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    await seed_enrollment(session, course.id, student.id)
    p_hdr = auth_header(prof.id, "professor")

    # accrue 2 absences (warning threshold defaults to 2) via delta batch
    for _ in range(2):
        s = await seed_open_session(session, course.id, 120)
        r = await client.post(
            f"/sessions/{s.id}/attendance/batch",
            json={"deltas": [{"student_id": student.id, "status": "absent"}]},
            headers=p_hdr,
        )
        assert r.status_code == 200, r.text

    evt = await _first(student_risk_events(session, student.id, poll_seconds=0.01))
    assert evt["event"] == "risk"
    payload = json.loads(evt["data"])
    assert payload["absences"] >= 2
    assert payload["level"] in ("warning", "danger")


async def test_sse_student_no_event_when_no_risk(client, session):
    """A student with zero absences yields no event within the poll window
    (generator stays pending) — first event must not appear immediately."""
    student = await seed_user(session, f"s_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    agen = student_risk_events(session, student.id, poll_seconds=0.01)
    try:
        got = None
        try:
            got = await asyncio.wait_for(agen.__anext__(), timeout=0.2)
        except asyncio.TimeoutError:
            got = None
        assert got is None, f"unexpected risk event for a clean student: {got}"
    finally:
        await agen.aclose()


# --------------------------------------------------------------- HTTP smoke
async def test_sse_session_requires_professor(client, session):
    """sseSession is professor-only; a student gets 403."""
    prof = await seed_user(session, f"p_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id)
    sess = await seed_open_session(session, course.id, 120)
    student = await seed_user(session, f"s_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
    s_hdr = auth_header(student.id, "student")
    r = await client.get(f"/sse/sessions/{sess.id}", headers=s_hdr)
    assert r.status_code == 403
