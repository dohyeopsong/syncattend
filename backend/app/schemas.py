"""
Pydantic request/response schemas.

These mirror components.schemas in ../../contracts/openapi.yaml exactly
(field names and enums). The contract is the interface B/C consume.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, EmailStr, Field


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


class ReregisterConfirmBody(BaseModel):
    email: EmailStr
    code: str
    new_device_uuid: str


class DeviceBinding(BaseModel):
    account_id: str
    device_uuid: str
    bound_at: datetime


# ----------------------------------------------------------------- courses
class CreateCourseRequest(BaseModel):
    name: str


class CourseOut(BaseModel):
    id: str
    professor_id: str
    name: str
    created_at: datetime


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
