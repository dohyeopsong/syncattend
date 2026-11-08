"""
Pydantic request/response schemas.

These mirror components.schemas in ../../contracts/openapi.yaml exactly
(field names and enums). The contract is the interface B/C consume.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.periods import MAX_PERIOD, MIN_PERIOD


# ------------------------------------------------------------------- enums
class Role(str, Enum):
    student = "student"
    professor = "professor"


class AttendanceStatus(str, Enum):
    present = "present"
    absent = "absent"
    late = "late"
    early_leave = "early_leave"
    pending = "pending"


class CheckPhase(str, Enum):
    check_in = "check_in"
    check_out = "check_out"


class VerifyStatus(str, Enum):
    # `verified` = the student passed the CURRENT phase's auth window. The final
    # attendance status (present/late/early_leave/absent) is only resolved at
    # batchClose, so a successful verify no longer returns `present`.
    verified = "verified"
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
    # Student number (학번). Required for students and unique across all users;
    # professors leave this unset (stored as NULL).
    student_id: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def _student_requires_student_id(self) -> "RegisterUserRequest":
        if self.role == Role.student and not (self.student_id and self.student_id.strip()):
            raise ValueError("학생(student) 회원가입에는 학번(student_id)이 필요합니다.")
        if self.role == Role.professor and self.student_id:
            # Professors have no 학번 — reject rather than silently drop it.
            raise ValueError("교수(professor) 회원가입에는 학번을 입력할 수 없습니다.")
        return self


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: Role
    name: str | None = None
    student_id: str | None = None


# --- Signup email verification (team member's flow: send-code → verify-code) ---
class SendCodeRequest(BaseModel):
    # str (not EmailStr) so the @wku.ac.kr domain check is handled in the route,
    # matching the team member's original implementation.
    email: str

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v: object) -> object:
        return v.strip().lower() if isinstance(v, str) else v


class VerifyCodeRequest(BaseModel):
    email: str
    code: str

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v: object) -> object:
        return v.strip().lower() if isinstance(v, str) else v


class VerifyCodeResult(BaseModel):
    verified: bool
    message: str


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
PERIOD_ORDER_ERROR = "start_period must be <= end_period"


def period_order_ok(start: int | None, end: int | None) -> bool:
    """True unless both periods are set and inverted (start > end)."""
    return not (start is not None and end is not None and start > end)


def _validate_period_order(model):
    """When both start_period and end_period are set, require start <= end.
    Range (1..MAX_PERIOD) is enforced per-field via Field(ge/le)."""
    if not period_order_ok(model.start_period, model.end_period):
        raise ValueError(PERIOD_ORDER_ERROR)
    return model


class CreateCourseRequest(BaseModel):
    name: str
    code: str | None = None
    department: str | None = None
    professor_name: str | None = None
    day_of_week: int | None = Field(default=None, ge=0, le=6)  # 0=Mon..6=Sun
    start_period: int | None = Field(default=None, ge=MIN_PERIOD, le=MAX_PERIOD)
    end_period: int | None = Field(default=None, ge=MIN_PERIOD, le=MAX_PERIOD)
    location: str | None = None
    credits: float | None = None

    @model_validator(mode="after")
    def _check_period_order(self) -> "CreateCourseRequest":
        return _validate_period_order(self)


class UpdateCourseRequest(BaseModel):
    """Partial update — every field optional; only provided fields are applied."""

    name: str | None = None
    code: str | None = None
    department: str | None = None
    professor_name: str | None = None
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    start_period: int | None = Field(default=None, ge=MIN_PERIOD, le=MAX_PERIOD)
    end_period: int | None = Field(default=None, ge=MIN_PERIOD, le=MAX_PERIOD)
    location: str | None = None
    credits: float | None = None

    @model_validator(mode="after")
    def _check_period_order(self) -> "UpdateCourseRequest":
        return _validate_period_order(self)


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


# ---------------------------------------------------------- course schedules
class CreateScheduleRequest(BaseModel):
    """One weekly time slot for a course (e.g. Mon 1교시, or Wed 1~3교시)."""

    day_of_week: int = Field(ge=0, le=6)  # 0=Mon..6=Sun
    start_period: int = Field(ge=MIN_PERIOD, le=MAX_PERIOD)
    end_period: int = Field(ge=MIN_PERIOD, le=MAX_PERIOD)

    @model_validator(mode="after")
    def _check_period_order(self) -> "CreateScheduleRequest":
        if not period_order_ok(self.start_period, self.end_period):
            raise ValueError(PERIOD_ORDER_ERROR)
        return self


class ScheduleOut(BaseModel):
    id: str
    course_id: str
    day_of_week: int
    start_period: int
    end_period: int


class EnrollRequest(BaseModel):
    student_id: str


class EnrollmentOut(BaseModel):
    course_id: str
    student_id: str
    # Readable display fields joined from the user (school student number + name).
    # Bots surface here as e.g. "SIMbot1a2b3c4d" / "시뮬_bot1a2b3c4d" so they are
    # visible in the professor's roster alongside real students.
    student_number: str | None = None
    name: str | None = None


# ---------------------------------------------------------------- sessions
class CreateSessionRequest(BaseModel):
    course_id: str
    window_seconds: int = 60
    week_number: int | None = Field(default=None, ge=1, le=15)  # 1..15주차
    schedule_id: str | None = None  # which weekly slot (Mon vs Tue) this session is


class ExtendWindowRequest(BaseModel):
    add_seconds: int = 60


class OpenCheckoutRequest(BaseModel):
    """Open the check_out (end-of-class) auth window. Optional window length;
    defaults to the session's original window_seconds."""
    window_seconds: int | None = Field(default=None, ge=1, le=3600)


class SessionOut(BaseModel):
    session_id: str
    course_id: str
    week_number: int | None = None
    schedule_id: str | None = None
    window_open: bool
    window_remaining: int
    phase: str


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
    # Which phase this verify attempt counted towards (check_in / check_out).
    # Set on a successful verify; None on rejection.
    check_phase: CheckPhase | None = None
    risk_warning: RiskWarning | None = None


class AttendanceRecord(BaseModel):
    record_id: str
    session_id: str
    student_id: str
    status: AttendanceStatus
    check_in_verified_at: datetime | None = None
    check_out_verified_at: datetime | None = None


class MyAttendanceItem(BaseModel):
    """One row of a student's own attendance history, with course context."""

    record_id: str
    session_id: str
    course_id: str
    course_name: str
    week_number: int | None = None
    status: AttendanceStatus
    check_in_verified_at: datetime | None = None
    check_out_verified_at: datetime | None = None
    session_opened_at: datetime | None = None


class AttendanceDelta(BaseModel):
    student_id: str
    status: AttendanceStatus


class BatchCloseRequest(BaseModel):
    deltas: list[AttendanceDelta]


class CorrectAttendanceRequest(BaseModel):
    status: AttendanceStatus


class UnverifiedStudent(BaseModel):
    """A student who has not yet verified (no present/absent record) for a
    session, with readable display fields so the professor review table can show
    the school 학번 + name instead of the raw user UUID."""
    student_id: str  # internal user id (UUID) — the Delta/batch key
    student_number: str | None = None  # school 학번, joined from the user
    name: str | None = None  # display name, joined from the user


class AttendanceAggregate(BaseModel):
    session_id: str
    total: int
    present: int
    absent: int = 0
    late: int = 0
    early_leave: int = 0
    unverified: list[UnverifiedStudent] = Field(default_factory=list)


# --------------------------------------------------------------- simulation
# Virtual attendance simulation: the professor opens a session, then runs all
# verify cases against synthetic students to confirm the 4-step gate works.
# cleanup deletes the synthetic students/devices/attendance afterwards.

class SimulationCase(BaseModel):
    name: str
    expected_rejected: bool
    expected_reason: VerifyReason | None
    rejected: bool
    reason: VerifyReason | None
    passed: bool  # True if the actual result matches the expected outcome


class SimulationResult(BaseModel):
    session_id: str
    cases: list[SimulationCase]
    cleaned_up: bool


# Virtual bot population: create N synthetic students enrolled in the session's
# course, have a fraction verify (present) and leave the rest unverified, so the
# professor dashboard (stat cards / realtime SSE / Delta close) populates with
# realistic data without real students. Data is NOT auto-cleaned — call the
# cleanup endpoint to remove the bots afterwards.

class SimulateBotsRequest(BaseModel):
    count: int = Field(default=20, ge=1, le=200)
    # Fraction of bots that successfully verify (0.0..1.0). The rest stay
    # 미인증 (enrolled but no present record).
    present_ratio: float = Field(default=0.7, ge=0.0, le=1.0)
    # Each bot waits a random delay in [delay_min, delay_max] seconds before
    # verifying, so attendance trickles in over time (realistic for testing the
    # realtime dashboard / SSE). Defaults 5..25s; set both 0 for instant.
    delay_min: float = Field(default=5.0, ge=0.0, le=600.0)
    delay_max: float = Field(default=25.0, ge=0.0, le=600.0)


class SimulateBotsResult(BaseModel):
    course_id: str
    total_bots: int
    # Number of bots SCHEDULED to verify as present (actual count appears in the
    # dashboard as background verification completes). The rest stay 미인증.
    present: int
    unverified: int


class BotCleanupResult(BaseModel):
    course_id: str
    removed: int
    cleaned_up: bool

