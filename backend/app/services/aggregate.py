"""Attendance aggregation + risk-group (absence) helpers."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Attendance, Enrollment, Session, User
from app.schemas import AttendanceAggregate, RiskLevel, RiskWarning, UnverifiedStudent


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

    # Present students (verified through the real path).
    present_rows = (
        await db.execute(
            select(Attendance.student_id).where(
                Attendance.session_id == session_id, Attendance.status == "present"
            )
        )
    ).scalars().all()
    present_set = set(present_rows)

    # Absent students (resolved by the professor via 출석 마감 / Delta close).
    # These are no longer "미인증" — the professor has explicitly marked them,
    # so they leave the unverified list once committed.
    absent_rows = (
        await db.execute(
            select(Attendance.student_id).where(
                Attendance.session_id == session_id, Attendance.status == "absent"
            )
        )
    ).scalars().all()
    absent_set = set(absent_rows)

    resolved = present_set | absent_set
    total = len(enrolled) if enrolled else len(present_set)
    unverified_ids = [s for s in enrolled if s not in resolved]

    # Join the User rows once so the professor review table can show the school
    # 학번 (student_number) + name instead of raw UUIDs. Done in a single query
    # keyed by the unverified ids; missing users (shouldn't happen) fall back to
    # None display fields.
    unverified: list[UnverifiedStudent] = []
    if unverified_ids:
        rows = (
            await db.execute(
                select(User.id, User.student_id, User.name).where(
                    User.id.in_(unverified_ids)
                )
            )
        ).all()
        by_id = {uid: (snum, name) for uid, snum, name in rows}
        # Preserve the enrolled order (deterministic) rather than DB row order.
        for sid in unverified_ids:
            snum, name = by_id.get(sid, (None, None))
            unverified.append(
                UnverifiedStudent(
                    student_id=sid, student_number=snum, name=name
                )
            )

    return AttendanceAggregate(
        session_id=session_id,
        total=total,
        present=len(present_set),
        absent=len(absent_set),
        unverified=unverified,
    )


async def absence_count(
    db: AsyncSession, student_id: str, course_id: str | None = None
) -> int:
    """
    Count a student's 'absent' records.

    When [course_id] is given, only absences in that course are counted (join
    Attendance -> Session -> course). This is the intended basis for the
    "2~3 absences in THIS course" warning; without it the count would span every
    course the student takes. When omitted, counts across all courses (legacy).
    """
    stmt = (
        select(func.count())
        .select_from(Attendance)
        .where(Attendance.student_id == student_id, Attendance.status == "absent")
    )
    if course_id is not None:
        stmt = stmt.join(Session, Attendance.session_id == Session.id).where(
            Session.course_id == course_id
        )
    return int((await db.execute(stmt)).scalar_one())


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
