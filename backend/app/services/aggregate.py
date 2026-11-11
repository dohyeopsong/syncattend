"""Attendance aggregation + risk-group (absence) helpers."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Attendance, Course, Enrollment, Session, User
from app.schemas import (
    AttendanceAggregate,
    AttendanceMatrix,
    AttendanceMatrixStudent,
    AttendanceStatus,
    RiskLevel,
    RiskWarning,
    UnverifiedStudent,
)

# Semester length — the matrix is always 15 columns (week 1..15).
_MATRIX_WEEKS = 15

# Severity rank for combining multiple sessions in the same week into one cell.
# Higher = worse; the worst status wins so the F-risk view stays conservative.
_SEVERITY = {"present": 0, "early_leave": 1, "late": 2, "pending": 3, "absent": 4}

# Final (resolved) attendance statuses — anything not in this set is `pending`
# and must be derived from the check_in/check_out timestamps.
_RESOLVED = {"present", "absent", "late", "early_leave"}


def _derive_closed(status, check_in_at, check_out_at) -> str:
    """Derive the final status at close time from the two timestamps.

    Used when phase=closed (or whenever a row is still pending after close):
      both passed   -> present
      check_in only -> early_leave (조퇴)
      check_out only-> late (지각)
      neither       -> absent
    A row whose status was already resolved (professor correction / explicit
    delta) is kept as-is.
    """
    if status in _RESOLVED:
        return status
    if check_in_at and check_out_at:
        return "present"
    if check_in_at and not check_out_at:
        return "early_leave"
    if check_out_at and not check_in_at:
        return "late"
    return "absent"


def _derive_live(status, check_in_at, check_out_at, phase) -> str:
    """Derive the display status while the session is still open.

    A resolved status is shown as-is. A pending row counts as `present` if the
    student has passed the CURRENTLY active phase (check_in stamp during
    check_in, check_out stamp during check_out); otherwise it is unverified.
    Late/early_leave are NOT shown until close — during check_out, a student who
    only passed check_in is simply still unverified for the active window.
    """
    if status in _RESOLVED:
        return status
    if phase == "check_in":
        return "present" if check_in_at else "unverified"
    # check_out phase
    return "present" if check_out_at else "unverified"


async def build_aggregate(db: AsyncSession, session_id: str) -> AttendanceAggregate:
    session = (
        await db.execute(select(Session).where(Session.id == session_id))
    ).scalar_one_or_none()
    course_id = session.course_id if session else None
    phase = session.phase if session else "closed"

    enrolled = (
        await db.execute(
            select(Enrollment.student_id).where(Enrollment.course_id == course_id)
        )
    ).scalars().all() if course_id else []

    records = (
        await db.execute(
            select(Attendance).where(Attendance.session_id == session_id)
        )
    ).scalars().all()
    rec_by_student = {r.student_id: r for r in records}

    present = late = early_leave = absent = 0
    unverified_ids: list[str] = []
    for sid in enrolled:
        r = rec_by_student.get(sid)
        if r is None:
            unverified_ids.append(sid)
            continue
        if phase == "closed":
            derived = _derive_closed(
                r.status, r.check_in_verified_at, r.check_out_verified_at
            )
        else:
            derived = _derive_live(
                r.status, r.check_in_verified_at, r.check_out_verified_at, phase
            )
        if derived == "present":
            present += 1
        elif derived == "late":
            late += 1
        elif derived == "early_leave":
            early_leave += 1
        elif derived == "absent":
            absent += 1
        else:
            unverified_ids.append(sid)

    total = len(enrolled) if enrolled else (present + late + early_leave + absent)
    resolved_count = present + late + early_leave + absent
    if not enrolled:
        # No enrollments: total falls back to the resolved count.
        pass

    # Join the User rows once so the professor review table can show the school
    # 학번 (student_number) + name instead of raw UUIDs.
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
        present=present,
        absent=absent,
        late=late,
        early_leave=early_leave,
        unverified=unverified,
    )


async def build_course_matrix(db: AsyncSession, course_id: str) -> AttendanceMatrix:
    """Build the cumulative per-student x per-week attendance matrix for a course.

    For each enrolled student, returns a 15-element `weeks` list (index 0 =
    week 1). `None` means no session was held that week. Closed sessions derive
    the final status from the check_in/check_out timestamps (via _derive_closed);
    open sessions show `present` if the student passed the currently-active
    phase (via _derive_live, with `unverified` mapped to `pending`). When a week
    has multiple sessions, the worst status (by _SEVERITY) wins.
    """
    course = (
        await db.execute(select(Course).where(Course.id == course_id))
    ).scalar_one_or_none()
    course_name = course.name if course else None

    # Only sessions with a week_number fit the 15-week grid; legacy/null-week
    # sessions are excluded (they have no column to live in).
    sessions = (
        (
            await db.execute(
                select(Session)
                .where(
                    Session.course_id == course_id,
                    Session.week_number.isnot(None),
                )
                .order_by(Session.week_number)
            )
        )
        .scalars()
        .all()
    )
    sessions_by_week: dict[int, list[Session]] = {}
    for s in sessions:
        assert s.week_number is not None  # narrowed by the filter above
        if 1 <= s.week_number <= _MATRIX_WEEKS:
            sessions_by_week.setdefault(s.week_number, []).append(s)

    # Enrolled students, joined to User for 학번 + name. Bots appear too.
    enrolled = (
        await db.execute(
            select(Enrollment.student_id, User.student_id, User.name)
            .join(User, User.id == Enrollment.student_id)
            .where(Enrollment.course_id == course_id)
            .order_by(User.student_id)
        )
    ).all()

    # All attendance records for the course's sessions, keyed by
    # (session_id, student_id) for O(1) lookup while building rows.
    session_ids = [s.id for s in sessions]
    records: list[Attendance] = []
    if session_ids:
        records = (
            (
                await db.execute(
                    select(Attendance).where(Attendance.session_id.in_(session_ids))
                )
            )
            .scalars()
            .all()
        )
    rec_by_key = {(r.session_id, r.student_id): r for r in records}

    students_out: list[AttendanceMatrixStudent] = []
    for uid, snum, name in enrolled:
        weeks: list[AttendanceStatus | None] = [None] * _MATRIX_WEEKS
        for wnum, sess_list in sessions_by_week.items():
            idx = wnum - 1
            worst: str | None = None
            for sess in sess_list:
                r = rec_by_key.get((sess.id, uid))
                status = r.status if r else None
                check_in = r.check_in_verified_at if r else None
                check_out = r.check_out_verified_at if r else None
                if sess.phase == "closed":
                    derived = _derive_closed(status, check_in, check_out)
                else:
                    derived = _derive_live(status, check_in, check_out, sess.phase)
                    # _derive_live returns "unverified" for not-yet-passed
                    # students; map to the DB status `pending` so the matrix
                    # only ever emits AttendanceStatus values.
                    if derived == "unverified":
                        derived = "pending"
                if worst is None or _SEVERITY.get(derived, 0) > _SEVERITY.get(worst, 0):
                    worst = derived
            weeks[idx] = AttendanceStatus(worst) if worst else None
        students_out.append(
            AttendanceMatrixStudent(
                student_id=uid, student_number=snum, name=name, weeks=weeks
            )
        )

    weeks_with_sessions = sorted(sessions_by_week.keys())
    return AttendanceMatrix(
        course_id=course_id,
        course_name=course_name,
        weeks=weeks_with_sessions,
        students=students_out,
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
