"""Attendance aggregation + risk-group (absence) helpers."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Attendance, Enrollment, Session
from app.schemas import AttendanceAggregate, RiskLevel, RiskWarning


async def build_aggregate(db: AsyncSession, session_id: str) -> AttendanceAggregate:
    session = (
        await db.execute(select(Session).where(Session.id == session_id))
    ).scalar_one_or_none()
    course_id = session.course_id if session else None

    enrolled = (
        await db.execute(
            select(Enrollment.student_id).where(Enrollment.course_id == course_id)
        )
    ).scalars().all() if course_id else []

    present_rows = (
        await db.execute(
            select(Attendance.student_id).where(
                Attendance.session_id == session_id, Attendance.status == "present"
            )
        )
    ).scalars().all()
    present_set = set(present_rows)

    total = len(enrolled) if enrolled else len(present_set)
    unverified = [s for s in enrolled if s not in present_set]
    return AttendanceAggregate(
        session_id=session_id,
        total=total,
        present=len(present_set),
        unverified=unverified,
    )


async def absence_count(db: AsyncSession, student_id: str) -> int:
    return int(
        (
            await db.execute(
                select(func.count()).select_from(Attendance).where(
                    Attendance.student_id == student_id, Attendance.status == "absent"
                )
            )
        ).scalar_one()
    )


def risk_warning_for(absences: int) -> RiskWarning | None:
    """
    Map an absence count to a risk warning using externalized thresholds.

    absences >= risk_absence_threshold  -> danger
    absences >= risk_warning_threshold  -> warning (and below danger)
    otherwise                            -> None (no warning)
    """
    settings = get_settings()
    danger_at = settings.risk_absence_threshold
    warning_at = settings.risk_warning_threshold
    if absences >= danger_at:
        return RiskWarning(
            level=RiskLevel.danger,
            absences=absences,
            message=f"결석 {absences}회 — 위험군",
        )
    if absences >= warning_at:
        return RiskWarning(
            level=RiskLevel.warning,
            absences=absences,
            message=f"결석 {absences}회 — 주의",
        )
    return None
