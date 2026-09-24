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

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser, get_current_user, require_professor
from app.models import Course, Enrollment, User
from app.schemas import (
    CourseCatalogItem,
    CourseOut,
    CreateCourseRequest,
    EnrollmentOut,
    EnrollRequest,
    MyCourseItem,
    Role,
    UpdateCourseRequest,
)

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
    return EnrollmentOut(course_id=course_id, student_id=body.student_id)


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
    rows = (
        await db.execute(
            select(Enrollment).where(Enrollment.course_id == course_id)
        )
    ).scalars().all()
    return [
        EnrollmentOut(course_id=e.course_id, student_id=e.student_id) for e in rows
    ]


# ----------------------------------------------- student catalog + self-enroll
@router.get(
    "/catalog",
    response_model=list[CourseCatalogItem],
    operation_id="listCourseCatalog",
)
async def list_course_catalog(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CourseCatalogItem]:
    """All offered courses, for any authenticated user to browse (timetable
    planning). Flags which ones the caller is already enrolled in."""
    courses = (
        await db.execute(select(Course).order_by(Course.name))
    ).scalars().all()
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
