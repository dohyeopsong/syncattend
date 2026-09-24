"""
Load-oriented checks for Delta-batch close (batchCloseAttendance).

The endpoint's contract is "apply only the changed records". We assert that
property by counting the actual INSERT/UPDATE statements SQLAlchemy emits, so a
no-op delta (status already equal) produces *zero* writes, and a large batch of
unchanged rows stays flat regardless of size.

Instrumentation uses SQLAlchemy's Core `before_cursor_execute` event on the
test engine's sync_engine (works with the aiosqlite dialect).
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager

from sqlalchemy import event

from tests.conftest import (
    auth_header,
    seed_course,
    seed_enrollment,
    seed_open_session,
    seed_user,
)


@contextmanager
def count_dml(engine):
    """Count INSERT/UPDATE statements executed on the given async engine."""
    counts = {"insert": 0, "update": 0}
    sync_engine = engine.sync_engine

    def _on_exec(conn, cursor, statement, params, context, executemany):
        head = statement.lstrip().split(" ", 1)[0].upper()
        if head == "INSERT":
            counts["insert"] += 1
        elif head == "UPDATE":
            counts["update"] += 1

    event.listen(sync_engine, "before_cursor_execute", _on_exec)
    try:
        yield counts
    finally:
        event.remove(sync_engine, "before_cursor_execute", _on_exec)


async def _prof_course_session(client, session, n_students):
    prof = await seed_user(session, f"p_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="professor")
    course = await seed_course(session, prof.id)
    sess = await seed_open_session(session, course.id, 60)
    students = []
    for _ in range(n_students):
        st = await seed_user(session, f"s_{uuid.uuid4().hex[:6]}@wku.ac.kr", role="student")
        await seed_enrollment(session, course.id, st.id)
        students.append(st)
    return prof, course, sess, students


async def test_delta_batch_inserts_only_new_rows(client, session, engine):
    """First close of N absent students → exactly N INSERTs, 0 UPDATEs."""
    prof, course, sess, students = await _prof_course_session(client, session, 5)
    p_hdr = auth_header(prof.id, "professor")
    deltas = [{"student_id": s.id, "status": "absent"} for s in students]

    with count_dml(engine) as counts:
        r = await client.post(
            f"/sessions/{sess.id}/attendance/batch",
            json={"deltas": deltas},
            headers=p_hdr,
        )
    assert r.status_code == 200, r.text
    assert counts["insert"] == 5   # one row per previously-unrecorded student
    assert counts["update"] == 0   # nothing to update on first close


async def test_delta_batch_reclose_is_noop(client, session, engine):
    """
    Re-closing with identical statuses writes nothing: the 'only changed'
    guard skips rows whose status already matches. This is the load-critical
    property — repeated closes don't churn the table.
    """
    prof, course, sess, students = await _prof_course_session(client, session, 5)
    p_hdr = auth_header(prof.id, "professor")
    deltas = [{"student_id": s.id, "status": "absent"} for s in students]

    # first close records everyone
    await client.post(
        f"/sessions/{sess.id}/attendance/batch", json={"deltas": deltas}, headers=p_hdr
    )

    # identical second close → no INSERTs, no UPDATEs
    with count_dml(engine) as counts:
        r = await client.post(
            f"/sessions/{sess.id}/attendance/batch",
            json={"deltas": deltas},
            headers=p_hdr,
        )
    assert r.status_code == 200, r.text
    assert counts["insert"] == 0
    assert counts["update"] == 0


async def test_delta_batch_updates_only_changed(client, session, engine):
    """
    Mixed re-close: only the rows whose status actually changed are UPDATEd;
    unchanged rows in the same batch emit no write.
    """
    prof, course, sess, students = await _prof_course_session(client, session, 5)
    p_hdr = auth_header(prof.id, "professor")

    # seed all 5 as absent
    await client.post(
        f"/sessions/{sess.id}/attendance/batch",
        json={"deltas": [{"student_id": s.id, "status": "absent"} for s in students]},
        headers=p_hdr,
    )

    # flip only 2 of them to present; the other 3 keep 'absent'
    changed = students[:2]
    unchanged = students[2:]
    mixed = [{"student_id": s.id, "status": "present"} for s in changed] + [
        {"student_id": s.id, "status": "absent"} for s in unchanged
    ]
    with count_dml(engine) as counts:
        r = await client.post(
            f"/sessions/{sess.id}/attendance/batch",
            json={"deltas": mixed},
            headers=p_hdr,
        )
    assert r.status_code == 200, r.text
    assert counts["insert"] == 0
    assert counts["update"] == 2   # only the two changed rows
    assert r.json()["present"] == 2


async def test_delta_batch_scales_flat_on_noop(client, session, engine):
    """
    Load sanity: a large no-op batch (50 unchanged rows) still emits zero
    writes — write volume tracks the *delta*, not the batch size.
    """
    prof, course, sess, students = await _prof_course_session(client, session, 50)
    p_hdr = auth_header(prof.id, "professor")
    deltas = [{"student_id": s.id, "status": "absent"} for s in students]

    await client.post(
        f"/sessions/{sess.id}/attendance/batch", json={"deltas": deltas}, headers=p_hdr
    )
    with count_dml(engine) as counts:
        r = await client.post(
            f"/sessions/{sess.id}/attendance/batch",
            json={"deltas": deltas},
            headers=p_hdr,
        )
    assert r.status_code == 200, r.text
    assert counts["insert"] == 0
    assert counts["update"] == 0
