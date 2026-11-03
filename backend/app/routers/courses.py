"""
Courses router — professor course CRUD + student catalog / self-enrollment.

operationIds:
  createCourse, listCourses, updateCourse, deleteCourse,
  enrollStudent, listEnrollments,
  listCourseCatalog, enrollSelf, unenrollSelf, listMyCourses.

Course/Enrollment ORM models already exist (see app/models.py). Professor write
operations require the professor role and ownership of the target course.
Catalog + self-enroll + my-courses are for authenticated students building
their timetable.
"""
from __future__ import annotations

import asyncio
import random
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser, get_current_user, require_professor
from app.models import Course, CourseSchedule, Enrollment, User
from app.schemas import (
    BotCleanupResult,
    CourseCatalogItem,
    CourseOut,
    CreateCourseRequest,
    CreateScheduleRequest,
    EnrollmentOut,
    EnrollRequest,
    MyCourseItem,
    PERIOD_ORDER_ERROR,
    Role,
    ScheduleOut,
    SimulateBotsRequest,
    SimulateBotsResult,
    UpdateCourseRequest,
    period_order_ok,
)
from app.services.simulation import cleanup_sim, make_sim_student, verify_bot_for_course

router = APIRouter(prefix="/courses", tags=["courses"])
# /me/* lives outside the /courses prefix (mirrors attendance's /me/attendance).
me_router = APIRouter(prefix="/me", tags=["courses"])


def _course_out(c: Course) -> CourseOut:
    return CourseOut(
        id=c.id,
        professor_id=c.professor_id,
        name=c.name,
        code=c.code,
        department=c.department,
        professor_name=c.professor_name,
        day_of_week=c.day_of_week,
        start_period=c.start_period,
        end_period=c.end_period,
        location=c.location,
        credits=float(c.credits) if c.credits is not None else None,
        created_at=c.created_at,
    )


async def _load_owned_course(
    db: AsyncSession, course_id: str, professor_id: str
) -> Course:
    course = (
        await db.execute(select(Course).where(Course.id == course_id))
    ).scalar_one_or_none()
    if course is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="course not found"
        )
    if course.professor_id != professor_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="not your course"
        )
    return course


# ----------------------------------------------------------- professor CRUD
@router.post(
    "",
    response_model=CourseOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createCourse",
)
async def create_course(
    body: CreateCourseRequest,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> CourseOut:
    course = Course(
        professor_id=prof.id,
        name=body.name,
        code=body.code,
        department=body.department,
        professor_name=body.professor_name,
        day_of_week=body.day_of_week,
        start_period=body.start_period,
        end_period=body.end_period,
        location=body.location,
        credits=body.credits,
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return _course_out(course)


@router.get("", response_model=list[CourseOut], operation_id="listCourses")
async def list_courses(
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> list[CourseOut]:
    rows = (
        await db.execute(
            select(Course)
            .where(Course.professor_id == prof.id)
            .order_by(Course.created_at)
        )
    ).scalars().all()
    return [_course_out(c) for c in rows]


@router.patch(
    "/{course_id}", response_model=CourseOut, operation_id="updateCourse"
)
async def update_course(
    course_id: str,
    body: UpdateCourseRequest,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> CourseOut:
    course = await _load_owned_course(db, course_id, prof.id)
    # Apply only fields the client actually sent (partial update).
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    # After merge, guard the period pair on the resulting row (a partial update
    # that sets only one period could otherwise invert start/end). Same rule as
    # the request schemas — see schemas.period_order_ok.
    if not period_order_ok(course.start_period, course.end_period):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=PERIOD_ORDER_ERROR,
        )
    await db.commit()
    await db.refresh(course)
    return _course_out(course)


@router.delete(
    "/{course_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteCourse",
)
async def delete_course(
    course_id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> Response:
    course = await _load_owned_course(db, course_id, prof.id)
    # enrollments + sessions (+ their attendance) cascade via FK ON DELETE CASCADE.
    await db.delete(course)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------- professor enrollment mgmt
@router.post(
    "/{course_id}/enrollments",
    response_model=EnrollmentOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="enrollStudent",
)
async def enroll_student(
    course_id: str,
    body: EnrollRequest,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentOut:
    await _load_owned_course(db, course_id, prof.id)

    student = (
        await db.execute(select(User).where(User.id == body.student_id))
    ).scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="student not found"
        )
    if student.role != Role.student.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target account is not a student",
        )

    existing = (
        await db.execute(
            select(Enrollment).where(
                Enrollment.course_id == course_id,
                Enrollment.student_id == body.student_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="student already enrolled"
        )

    enrollment = Enrollment(course_id=course_id, student_id=body.student_id)
    db.add(enrollment)
    await db.commit()
    return EnrollmentOut(
        course_id=course_id,
        student_id=body.student_id,
        student_number=student.student_id,
        name=student.name,
    )


@router.get(
    "/{course_id}/enrollments",
    response_model=list[EnrollmentOut],
    operation_id="listEnrollments",
)
async def list_enrollments(
    course_id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> list[EnrollmentOut]:
    await _load_owned_course(db, course_id, prof.id)
    # Join users so the roster can show the school student number + name
    # (otherwise only the opaque user id is available). Bots surface here too
    # (student_id "SIMbot…" / name "시뮬_…") so the professor can see them.
    rows = (
        await db.execute(
            select(Enrollment, User)
            .join(User, User.id == Enrollment.student_id)
            .where(Enrollment.course_id == course_id)
            .order_by(User.student_id)
        )
    ).all()
    return [
        EnrollmentOut(
            course_id=e.course_id,
            student_id=e.student_id,
            student_number=u.student_id,
            name=u.name,
        )
        for e, u in rows
    ]


# --------------------------------------------------- professor bot population
# Virtual bot students populate the dashboard with realistic attendance data
# (present + 미인증) so the professor can test realtime monitoring (SSE), stat
# cards, and 출석 마감 without real students. Bots are COURSE-scoped: they are
# enrolled as 미인증 course students immediately (so the roster + dashboard total
# reflect them at once), and the present bots wait for the session's auth window
# to open, then verify after a per-bot random delay. Calling again ADDS more
# bots (UUID-based labels prevent collision). DELETE removes ALL bots at once.
@router.post(
    "/{course_id}/simulate-bots",
    response_model=SimulateBotsResult,
    operation_id="simulateBots",
)
async def simulate_bots(
    course_id: str,
    body: SimulateBotsRequest,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> SimulateBotsResult:
    """Enroll `count` virtual bot students in this course, then schedule a
    `present_ratio` fraction to verify (present) once a session opens; the rest
    stay 미인증.

    Enrollment is SYNCHRONOUS: every bot is created, device-bound, and enrolled
    in the course within this request, so the dashboard's total + 미인증 (and the
    course roster) reflect them immediately — BEFORE the professor opens a
    session. The present bots then wait for the session's auth window to open
    (bounded wait) and sleep a random delay in [delay_min, delay_max] seconds
    (default 5..25) before verifying through the REAL path, so 출석 trickles
    into the realtime dashboard (SSE) one-by-one instead of arriving in a burst.

    Calling again ADDS more bots (UUID-based labels prevent email / student_id
    / device_uuid collision with bots from a previous call). Data is NOT cleaned
    up — call DELETE /courses/{course_id}/simulate-bots to remove ALL bots at
    once afterwards. Professor-only; course owned by the caller.
    """
    await _load_owned_course(db, course_id, prof.id)
    count = body.count
    present_target = round(count * body.present_ratio)

    dmin = min(body.delay_min, body.delay_max)
    dmax = max(body.delay_min, body.delay_max)

    # Enroll every bot synchronously so they appear in the roster (미인증)
    # right away. UUID-based labels guarantee uniqueness across repeated calls
    # (additive generation) — no email/student_id/device_uuid collision.
    bot_specs: list[tuple[str, str]] = []  # (user_id, device_uuid)
    for _ in range(count):
        label = f"bot{uuid.uuid4().hex[:8]}"
        uid, dev = await make_sim_student(db, label=label, course_id=course_id)
        bot_specs.append((uid, dev))
    await db.commit()

    # Schedule only the present bots to verify once the session window opens.
    for uid, dev in bot_specs[:present_target]:
        delay = random.uniform(dmin, dmax) if dmax > 0 else 0.0
        asyncio.create_task(verify_bot_for_course(course_id, uid, dev, delay))

    return SimulateBotsResult(
        course_id=course_id,
        total_bots=count,
        present=present_target,
        unverified=count - present_target,
    )


@router.delete(
    "/{course_id}/simulate-bots",
    response_model=BotCleanupResult,
    operation_id="cleanupBots",
)
async def cleanup_bots(
    course_id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> BotCleanupResult:
    """Remove all virtual bot students (and their devices/enrollments/
    attendance) so the dashboard returns to real data. Professor-only."""
    await _load_owned_course(db, course_id, prof.id)
    removed = await cleanup_sim(db)
    return BotCleanupResult(
        course_id=course_id, removed=removed, cleaned_up=True
    )


# ------------------------------------------------- professor weekly schedules
def _schedule_out(s: CourseSchedule) -> ScheduleOut:
    return ScheduleOut(
        id=s.id,
        course_id=s.course_id,
        day_of_week=s.day_of_week,
        start_period=s.start_period,
        end_period=s.end_period,
    )


@router.post(
    "/{course_id}/schedules",
    response_model=ScheduleOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="addCourseSchedule",
)
async def add_course_schedule(
    course_id: str,
    body: CreateScheduleRequest,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> ScheduleOut:
    """Add one weekly time slot (e.g. Mon 1교시) to a course. A course meeting
    multiple times per week has one row per slot."""
    await _load_owned_course(db, course_id, prof.id)
    dup = (
        await db.execute(
            select(CourseSchedule).where(
                CourseSchedule.course_id == course_id,
                CourseSchedule.day_of_week == body.day_of_week,
                CourseSchedule.start_period == body.start_period,
            )
        )
    ).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a slot with this day/start_period already exists",
        )
    slot = CourseSchedule(
        course_id=course_id,
        day_of_week=body.day_of_week,
        start_period=body.start_period,
        end_period=body.end_period,
    )
    db.add(slot)
    await db.commit()
    await db.refresh(slot)
    return _schedule_out(slot)


@router.get(
    "/{course_id}/schedules",
    response_model=list[ScheduleOut],
    operation_id="listCourseSchedules",
)
async def list_course_schedules(
    course_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ScheduleOut]:
    """All weekly slots of a course, ordered by day then period. Readable by any
    authenticated user (timetable rendering)."""
    course = (
        await db.execute(select(Course).where(Course.id == course_id))
    ).scalar_one_or_none()
    if course is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="course not found"
        )
    rows = (
        await db.execute(
            select(CourseSchedule)
            .where(CourseSchedule.course_id == course_id)
            .order_by(CourseSchedule.day_of_week, CourseSchedule.start_period)
        )
    ).scalars().all()
    return [_schedule_out(s) for s in rows]


@router.delete(
    "/{course_id}/schedules/{schedule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteCourseSchedule",
)
async def delete_course_schedule(
    course_id: str,
    schedule_id: str,
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _load_owned_course(db, course_id, prof.id)
    slot = (
        await db.execute(
            select(CourseSchedule).where(
                CourseSchedule.id == schedule_id,
                CourseSchedule.course_id == course_id,
            )
        )
    ).scalar_one_or_none()
    if slot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="schedule not found"
        )
    # sessions.schedule_id is ON DELETE SET NULL, so existing sessions survive.
    await db.delete(slot)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------- student catalog + self-enroll
@router.get(
    "/catalog",
    response_model=list[CourseCatalogItem],
    operation_id="listCourseCatalog",
)
async def list_course_catalog(
    q: str | None = Query(
        default=None,
        description="Partial match on course name / professor_name / code (case-insensitive)",
    ),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CourseCatalogItem]:
    """All offered courses, for any authenticated user to browse (timetable
    planning). Flags which ones the caller is already enrolled in.

    Optional `q` filters by course name, professor name, or 학수번호 (ILIKE,
    case-insensitive substring). Absent/blank `q` returns everything (the
    original behavior — backward compatible)."""
    stmt = select(Course)
    if q is not None and q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Course.name.ilike(pattern),
                Course.professor_name.ilike(pattern),
                Course.code.ilike(pattern),
            )
        )
    courses = (await db.execute(stmt.order_by(Course.name))).scalars().all()
    my_ids = set(
        (
            await db.execute(
                select(Enrollment.course_id).where(Enrollment.student_id == user.id)
            )
        ).scalars().all()
    )
    return [
        CourseCatalogItem(
            id=c.id,
            professor_id=c.professor_id,
            name=c.name,
            code=c.code,
            department=c.department,
            professor_name=c.professor_name,
            day_of_week=c.day_of_week,
            start_period=c.start_period,
            end_period=c.end_period,
            location=c.location,
            credits=float(c.credits) if c.credits is not None else None,
            enrolled=c.id in my_ids,
        )
        for c in courses
    ]


@router.post(
    "/{course_id}/enroll-self",
    response_model=EnrollmentOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="enrollSelf",
)
async def enroll_self(
    course_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EnrollmentOut:
    """A student enrolls themselves into a course (no body)."""
    if user.role != Role.student.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only students can self-enroll",
        )
    course = (
        await db.execute(select(Course).where(Course.id == course_id))
    ).scalar_one_or_none()
    if course is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="course not found"
        )
    existing = (
        await db.execute(
            select(Enrollment).where(
                Enrollment.course_id == course_id,
                Enrollment.student_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="already enrolled"
        )
    db.add(Enrollment(course_id=course_id, student_id=user.id))
    await db.commit()
    # CurrentUser exposes only id/role/email; the roster (listEnrollments) joins
    # the full user row to surface student_number + name, so None here is fine.
    return EnrollmentOut(course_id=course_id, student_id=user.id)


@router.delete(
    "/{course_id}/enroll-self",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="unenrollSelf",
)
async def unenroll_self(
    course_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """A student cancels their own enrollment."""
    existing = (
        await db.execute(
            select(Enrollment).where(
                Enrollment.course_id == course_id,
                Enrollment.student_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="not enrolled"
        )
    await db.delete(existing)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------- student timetable
@me_router.get(
    "/courses",
    response_model=list[MyCourseItem],
    operation_id="listMyCourses",
)
async def list_my_courses(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MyCourseItem]:
    """Courses the calling student is enrolled in (timetable data source)."""
    rows = (
        await db.execute(
            select(Course)
            .join(Enrollment, Enrollment.course_id == Course.id)
            .where(Enrollment.student_id == user.id)
            .order_by(Course.day_of_week, Course.start_period, Course.name)
        )
    ).scalars().all()
    return [
        MyCourseItem(
            id=c.id,
            professor_id=c.professor_id,
            name=c.name,
            code=c.code,
            department=c.department,
            professor_name=c.professor_name,
            day_of_week=c.day_of_week,
            start_period=c.start_period,
            end_period=c.end_period,
            location=c.location,
            credits=float(c.credits) if c.credits is not None else None,
        )
        for c in rows
    ]
