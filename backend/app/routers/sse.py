"""
SSE router — Server-Sent Events (WebSocket intentionally NOT used).

operationIds: sseStudent, sseSession.

- sseStudent: pushes RiskWarning events for a student (absence-based risk).
- sseSession: pushes AttendanceAggregate snapshots for a professor's live view.

Streams wake on Redis pub/sub notifications (published by verify / batchClose /
correct) instead of polling the DB on a fixed timer. A fallback re-check fires
only if no notification arrives within the fallback window, so a missed publish
can't freeze the stream. The contract (text/event-stream of the given schema)
is unchanged.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import (
    CurrentUser,
    get_current_user_for_sse,
    require_professor_for_sse,
)
from app.services.aggregate import absence_count, build_aggregate, risk_warning_for
from app.services.events import (
    session_channel,
    student_channel,
    wait_for_change,
)

router = APIRouter(prefix="/sse", tags=["sse"])


async def student_risk_events(
    db: AsyncSession, student_id: str
) -> AsyncGenerator[dict, None]:
    """Yield a 'risk' SSE event whenever the student's absence count changes
    into a warning/danger band. Emits an immediate first event, then blocks on
    a Redis pub/sub notification (published by verify / correct / batchClose)
    instead of polling the DB every 2 seconds."""
    last_absences = -1
    # First event: emit immediately so the client sees the current state.
    while True:
        absences = await absence_count(db, student_id)
        if absences != last_absences:
            last_absences = absences
            warning = risk_warning_for(absences)
            if warning is not None:
                yield {"event": "risk", "data": warning.model_dump_json()}
        # Block until a change notification arrives (or the fallback timer
        # fires). This replaces the old `await asyncio.sleep(2)` DB poll.
        await wait_for_change(student_channel(student_id))


async def session_attendance_events(
    db: AsyncSession, session_id: str
) -> AsyncGenerator[dict, None]:
    """Yield an 'attendance' SSE event with the current AttendanceAggregate
    whenever it changes. Emits an immediate first snapshot, then blocks on a
    Redis pub/sub notification (published by verify / batchClose / correct)
    instead of polling the DB every 2 seconds."""
    last_payload: str | None = None
    while True:
        agg = await build_aggregate(db, session_id)
        payload = agg.model_dump_json()
        if payload != last_payload:
            last_payload = payload
            yield {"event": "attendance", "data": payload}
        # Block until a change notification arrives (or the fallback timer).
        await wait_for_change(session_channel(session_id))


@router.get("/students/{id}", operation_id="sseStudent")
async def sse_student(
    id: str,
    user: CurrentUser = Depends(get_current_user_for_sse),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    return EventSourceResponse(student_risk_events(db, id))


@router.get("/sessions/{id}", operation_id="sseSession")
async def sse_session(
    id: str,
    prof: CurrentUser = Depends(require_professor_for_sse),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    return EventSourceResponse(session_attendance_events(db, id))
