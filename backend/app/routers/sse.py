"""
SSE router — Server-Sent Events (WebSocket intentionally NOT used).

operationIds: sseStudent, sseSession.

- sseStudent: pushes RiskWarning events for a student (absence-based risk).
- sseSession: pushes AttendanceAggregate snapshots for a professor's live view.

Streams poll the DB at a small interval; production could switch to Redis
pub/sub, but the contract (text/event-stream of the given schema) is unchanged.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser, get_current_user, require_professor
from app.services.aggregate import absence_count, build_aggregate, risk_warning_for

router = APIRouter(prefix="/sse", tags=["sse"])

_POLL_SECONDS = 2.0


@router.get("/students/{id}", operation_id="sseStudent")
async def sse_student(
    id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    async def event_gen() -> AsyncGenerator[dict, None]:
        last_absences = -1
        # Emit one immediate snapshot, then on change.
        while True:
            absences = await absence_count(db, id)
            if absences != last_absences:
                last_absences = absences
                warning = risk_warning_for(absences)
                if warning is not None:
                    yield {"event": "risk", "data": warning.model_dump_json()}
            await asyncio.sleep(_POLL_SECONDS)

    return EventSourceResponse(event_gen())


@router.get("/sessions/{id}", operation_id="sseSession")
async def sse_session(
    id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    async def event_gen() -> AsyncGenerator[dict, None]:
        last_payload: str | None = None
        while True:
            agg = await build_aggregate(db, id)
            payload = agg.model_dump_json()
            if payload != last_payload:
                last_payload = payload
                yield {"event": "attendance", "data": payload}
            await asyncio.sleep(_POLL_SECONDS)

    return EventSourceResponse(event_gen())
