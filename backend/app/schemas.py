"""
Pydantic request/response schemas.

These mirror components.schemas in ../../contracts/openapi.yaml exactly
(field names and enums). The contract is the interface B/C consume.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, EmailStr, Field, field_validator


# ------------------------------------------------------------------- enums
class Role(str, Enum):
    student = "student"
    professor = "professor"


class AttendanceStatus(str, Enum):
    present = "present"
    absent = "absent"
    pending = "pending"


class VerifyStatus(str, Enum):
    present = "present"
    pending = "pending"
    rejected = "rejected"


class VerifyReason(str, Enum):
    window_closed = "window_closed"
    cross_verify_failed = "cross_verify_failed"
    nonce_reused = "nonce_reused"
    device_mismatch = "device_mismatch"
    duplicate_attendance = "duplicate_attendance"


class RiskLevel(str, Enum):
    info = "info"
    warning = "warning"
    danger = "danger"


# ------------------------------------------------------------------ common
class Health(BaseModel):
    status: str = "ok"
    service: str = "syncattend-backend"
    version: str = "0.1.0"
    db: str = "unknown"
    redis: str = "unknown"


class Error(BaseModel):
    detail: str
    code: str | None = None


# -------------------------------------------------------------------- auth
class RegisterUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: Role
    name: str | None = None


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: Role
    name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: Role


# ----------------------------------------------------------------- devices
class RegisterDeviceRequest(BaseModel):
    device_uuid: str


class ReregisterRequestBody(BaseModel):
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v: object) -> object:
        # iOS keyboards/autofill often add leading whitespace or capitalize the
        # first letter, which makes EmailStr reject the value with a 422 before
        # any business logic runs. Normalize (strip + lower) before validation
        # so real-device input succeeds; uniqueness/domain checks stay intact.
        return v.strip().lower() if isinstance(v, str) else v


class ReregisterConfirmBody(BaseModel):
    email: EmailStr
    code: str
    new_device_uuid: str

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v: object) -> object:
        return v.strip().lower() if isinstance(v, str) else v

    @field_validator("code", mode="before")
    @classmethod
    def _normalize_code(cls, v: object) -> object:
        # Tolerate whitespace around the copied code.
        return v.strip() if isinstance(v, str) else v


class DeviceBinding(BaseModel):
    account_id: str
    device_uuid: str
    bound_at: datetime


# ----------------------------------------------------------------- courses
class CreateCourseRequest(BaseModel):
    name: str
    code: str | None = None
    department: str | None = None
    professor_name: str | None = None
    day_of_week: int | None = Field(default=None, ge=0, le=6)  # 0=Mon..6=Sun
    start_period: int | None = None
    end_period: int | None = None
    location: str | None = None
    credits: float | None = None


class UpdateCourseRequest(BaseModel):
    """Partial update — every field optional; only provided fields are applied."""

    name: str | None = None
    code: str | None = None
    department: str | None = None
    professor_name: str | None = None
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    start_period: int | None = None
    end_period: int | None = None
    location: str | None = None
    credits: float | None = None


class CourseOut(BaseModel):
    id: str
    professor_id: str
    name: str
    code: str | None = None
    department: str | None = None
    professor_name: str | None = None
    day_of_week: int | None = None
    start_period: int | None = None
    end_period: int | None = None
    location: str | None = None
    credits: float | None = None
    created_at: datetime


class CourseCatalogItem(BaseModel):
    """A course as seen by any authenticated user browsing the catalog."""

    id: str
    professor_id: str
    name: str
    code: str | None = None
    department: str | None = None
    professor_name: str | None = None
    day_of_week: int | None = None
    start_period: int | None = None
    end_period: int | None = None
    location: str | None = None
    credits: float | None = None
    enrolled: bool = False  # whether the calling student is enrolled


class MyCourseItem(BaseModel):
    """A course the calling student is enrolled in (timetable data source)."""

    id: str
    professor_id: str
    name: str
    code: str | None = None
    department: str | None = None
    professor_name: str | None = None
    day_of_week: int | None = None
    start_period: int | None = None
    end_period: int | None = None
    location: str | None = None
    credits: float | None = None


class EnrollRequest(BaseModel):
    student_id: str


class EnrollmentOut(BaseModel):
    course_id: str
    student_id: str


# ---------------------------------------------------------------- sessions
class CreateSessionRequest(BaseModel):
    course_id: str
    window_seconds: int = 60


class ExtendWindowRequest(BaseModel):
    add_seconds: int = 60


class SessionOut(BaseModel):
    session_id: str
    course_id: str
    window_open: bool
    window_remaining: int
    status: str


class SessionToken(BaseModel):
    session_id: str
    qr_token: str
    audio_nonce: str
    expires_in: int = 15
    window_open: bool
    window_remaining: int


# -------------------------------------------------------------- attendance
class VerifyRequest(BaseModel):
    session_id: str
    qr_token: str
    audio_nonce: str
    device_uuid: str


class RiskWarning(BaseModel):
    level: RiskLevel
    absences: int
    message: str


class VerifyResult(BaseModel):
    status: VerifyStatus
    cross_verified: bool
    device_matched: bool
    reason: VerifyReason | None = None
    risk_warning: RiskWarning | None = None


class AttendanceRecord(BaseModel):
    record_id: str
    session_id: str
    student_id: str
    status: AttendanceStatus
    verified_at: datetime | None = None


class MyAttendanceItem(BaseModel):
    """One row of a student's own attendance history, with course context."""

    record_id: str
    session_id: str
    course_id: str
    course_name: str
    status: AttendanceStatus
    verified_at: datetime | None = None
    session_opened_at: datetime | None = None


class AttendanceDelta(BaseModel):
    student_id: str
    status: AttendanceStatus


class BatchCloseRequest(BaseModel):
    deltas: list[AttendanceDelta]


class CorrectAttendanceRequest(BaseModel):
    status: AttendanceStatus


class AttendanceAggregate(BaseModel):
    session_id: str
    total: int
    present: int
    unverified: list[str] = Field(default_factory=list)
