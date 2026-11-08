"""
SQLAlchemy async ORM models.

Mirrors backend/migrations/0001_initial_schema.sql (owner A keeps these in sync).
Uses portable column types so the same models run on PostgreSQL (prod) and
SQLite (tests). UUIDs are stored as strings for cross-DB portability.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.timeutil import now as _now


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    # Student number (학번). Unique per student — two accounts must never share
    # one. Professors leave this NULL. Backfilled with a synthetic value for
    # accounts created before this column existed (see migration 0002).
    student_id: Mapped[str | None] = mapped_column(String(32), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        CheckConstraint("role IN ('student', 'professor')", name="ck_users_role"),
    )


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    device_uuid: Mapped[str] = mapped_column(String(36), nullable=False)
    bound_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (UniqueConstraint("device_uuid", name="uq_devices_device_uuid"),)


class DeviceChange(Base):
    __tablename__ = "device_changes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    old_device_uuid: Mapped[str | None] = mapped_column(String(36))
    new_device_uuid: Mapped[str] = mapped_column(String(36), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    verified_via: Mapped[str] = mapped_column(String(32), default="school_email")


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    professor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Optional timetable/catalog metadata (all nullable for backward compat).
    code: Mapped[str | None] = mapped_column(String(32))            # 학수번호 e.g. "374142"
    department: Mapped[str | None] = mapped_column(String(255))     # 학과명
    professor_name: Mapped[str | None] = mapped_column(String(255))  # display name
    day_of_week: Mapped[int | None] = mapped_column(Integer)        # 0=Mon .. 6=Sun
    start_period: Mapped[int | None] = mapped_column(Integer)       # 시작 교시
    end_period: Mapped[int | None] = mapped_column(Integer)         # 종료 교시
    location: Mapped[str | None] = mapped_column(String(255))       # 강의실
    credits: Mapped[float | None] = mapped_column(Numeric(3, 1))    # 학점
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        CheckConstraint(
            "day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)",
            name="ck_courses_day_of_week",
        ),
    )


class CourseSchedule(Base):
    """A single weekly time slot of a course (normalized timetable).

    A course can meet multiple times per week (e.g. Mon 1교시 + Tue 1교시), so
    each slot is one row here instead of single day/period columns on `courses`.
    This keeps the timetable in 1NF (no repeating groups) while the relation to
    `courses` stays a simple 1:N.
    """

    __tablename__ = "course_schedules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=Mon .. 6=Sun
    start_period: Mapped[int] = mapped_column(Integer, nullable=False)  # 시작 교시
    end_period: Mapped[int] = mapped_column(Integer, nullable=False)    # 종료 교시

    __table_args__ = (
        CheckConstraint(
            "day_of_week >= 0 AND day_of_week <= 6",
            name="ck_course_schedules_day_of_week",
        ),
        CheckConstraint(
            "start_period >= 1 AND end_period >= start_period",
            name="ck_course_schedules_period_range",
        ),
        UniqueConstraint(
            "course_id", "day_of_week", "start_period",
            name="uq_course_schedules_slot",
        ),
    )


class Enrollment(Base):
    __tablename__ = "enrollments"

    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    # Academic week number (1..15). Nullable for backward compatibility with
    # sessions created before this column existed; new sessions should set it so
    # attendance can be reported per week ("1주차 출석", "2주차 출석", ...).
    week_number: Mapped[int | None] = mapped_column(Integer)
    # Which weekly time slot this session belongs to (e.g. the Mon slot vs the
    # Tue slot of the same course). Nullable: sessions may be ad-hoc / legacy.
    schedule_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("course_schedules.id", ondelete="SET NULL")
    )
    # Attendance lifecycle phase. A session moves check_in → check_out → closed.
    # check_in: the "start" auth window is open (professor opened the session).
    # check_out: the "end" auth window is open (professor opened checkout).
    # closed: session finalised — attendance states are derived at batchClose.
    # `window_opened_at` / `window_expires_at` always describe the CURRENTLY
    # active window; opening checkout resets them to a fresh window.
    phase: Mapped[str] = mapped_column(String(16), nullable=False, default="check_in")
    window_opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now
    )
    window_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        CheckConstraint(
            "phase IN ('check_in', 'check_out', 'closed')", name="ck_sessions_phase"
        ),
        CheckConstraint(
            "week_number IS NULL OR (week_number >= 1 AND week_number <= 15)",
            name="ck_sessions_week_number",
        ),
    )


class Attendance(Base):
    __tablename__ = "attendance"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    device_uuid: Mapped[str] = mapped_column(String(36), nullable=False)
    # Status is only finalised at batchClose (phase=closed). Until then it stays
    # `pending` even after a successful verify — the two timestamps below are the
    # source of truth, and present/late/early_leave/absent are derived from them.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    # When the student passed the START (check_in) / END (check_out) auth window.
    # Either may be NULL (NULL = that phase was not passed). The combination
    # derives the final status at close time:
    #   both   -> present | check_in only -> early_leave
    #   check_out only -> late | neither -> absent
    check_in_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    check_out_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    corrected_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id")
    )

    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_attendance_session_student"),
        UniqueConstraint("session_id", "device_uuid", name="uq_attendance_session_device"),
        CheckConstraint(
            "status IN ('present', 'absent', 'late', 'early_leave', 'pending')",
            name="ck_attendance_status",
        ),
    )


class Nonce(Base):
    """Optional audit trail of consumed nonces (Redis is the primary store)."""

    __tablename__ = "nonces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consumed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"))

    __table_args__ = (
        UniqueConstraint("session_id", "kind", "value", name="uq_nonces_session_kind_value"),
        CheckConstraint("kind IN ('qr', 'audio')", name="ck_nonces_kind"),
    )
