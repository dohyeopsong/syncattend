"""
Courses router — professor course creation + student enrollment.

operationIds: createCourse, listCourses, enrollStudent, listEnrollments.

Course/Enrollment ORM models already exist (see app/models.py). All write
operations require the professor role and ownership of the target course.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import CurrentUser, require_professor
from app.models import Course, Enrollment, User
from app.schemas import (
    CourseOut,
    CreateCourseRequest,
    EnrollmentOut,
    EnrollRequest,
    Role,
)

router = APIRouter(prefix="/courses", tags=["courses"])


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
    course = Course(professor_id=prof.id, name=body.name)
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return CourseOut(
        id=course.id,
        professor_id=course.professor_id,
        name=course.name,
        created_at=course.created_at,
    )


@router.get("", response_model=list[CourseOut], operation_id="listCourses")
async def list_courses(
    prof: CurrentUser = Depends(require_professor),
    db: AsyncSession = Depends(get_db),
) -> list[CourseOut]:
    rows = (
        await db.execute(
            select(Course).where(Course.professor_id == prof.id).order_by(
                Course.created_at
            )
        )
    ).scalars().all()
    return [
        CourseOut(
            id=c.id,
            professor_id=c.professor_id,
            name=c.name,
            created_at=c.created_at,
        )
        for c in rows
    ]


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
