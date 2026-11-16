// Types mirrored from contracts/openapi.yaml (READ-ONLY contract, owner A).
// Keep in sync with the contract; do NOT hand-edit the contract itself.

export type Role = "student" | "professor";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  role: Role;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

// day_of_week: 0=Mon … 6=Sun (per contract), null when unscheduled.
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// A weekly slot as sent in create/update payloads (no id yet). Mirrors the
// contract's CreateScheduleRequest.
export interface ScheduleSlotInput {
  day_of_week: DayOfWeek;
  start_period: number;
  end_period: number;
}

export interface Course {
  id: string;
  professor_id: string;
  name: string;
  code: string | null;
  department: string | null;
  professor_name: string | null;
  day_of_week: DayOfWeek | null;
  start_period: number | null;
  end_period: number | null;
  location: string | null;
  credits: number | null;
  semester_start_date: string | null; // ISO date (YYYY-MM-DD); 1주차 월요일
  created_at: string;
  schedules: CourseScheduleSlot[]; // all weekly slots (multi-day support)
}

// name required; schedule fields optional. Mirrors CreateCourseRequest.
export interface CreateCourseRequest {
  name: string;
  code?: string | null;
  department?: string | null;
  professor_name?: string | null;
  day_of_week?: DayOfWeek | null;
  start_period?: number | null;
  end_period?: number | null;
  location?: string | null;
  credits?: number | null;
  semester_start_date?: string | null;
  // Multi-day weekly slots. null = leave scalar fields as-is; a list (even
  // empty) reconciles the course's slots to exactly those entries.
  schedules?: ScheduleSlotInput[] | null;
}

// PATCH — every field optional (partial update). Mirrors UpdateCourseRequest.
export type UpdateCourseRequest = Partial<CreateCourseRequest>;

// A browsable catalog entry (GET /courses/catalog). Same schedule shape as
// Course, plus `enrolled` for the calling user. Owner A's contract.
export interface CourseCatalogItem {
  id: string;
  professor_id: string;
  name: string;
  code: string | null;
  department: string | null;
  professor_name: string | null;
  day_of_week: DayOfWeek | null;
  start_period: number | null;
  end_period: number | null;
  location: string | null;
  credits: number | null;
  enrolled?: boolean;
  schedules: CourseScheduleSlot[];
}

export interface Enrollment {
  course_id: string;
  student_id: string;
  // Readable display fields joined from the user (school student number + name).
  // Bots surface here as e.g. "SIMbot1a2b3c4d" / "시뮬_bot1a2b3c4d".
  student_number?: string | null;
  name?: string | null;
}

export interface Session {
  session_id: string;
  course_id: string;
  week_number: number | null; // 1..15
  schedule_id: string | null; // which weekly slot
  schedule_label: string | null; // e.g. "월 1교시", "화 2~3교시"
  window_open: boolean;
  window_remaining: number; // seconds left in the currently active auth window
  phase: "check_in" | "check_out" | "closed";
  // True once the professor opened the 2차 (check_out) window at least once.
  // The UI uses this to show "2차 인증 열기" only when the second phase hasn't
  // happened yet (phase alone can't tell closed-after-1차 from closed-after-2차).
  checkout_opened: boolean;
}

// Estimate (week + slot) for a new session. POST /sessions/estimate.
export interface SessionEstimate {
  week_number: number | null;
  schedule_id: string | null;
  schedule_label: string | null;
  // Which auth round to default to. "check_out" when a closed session for the
  // estimated week+slot already has 1차 done but 2차 not opened — the modal
  // calls openCheckout on pending_session_id instead of createSession.
  suggested_phase: "check_in" | "check_out";
  pending_session_id: string | null;
}

// One weekly time slot of a course. GET /courses/{course_id}/schedules.
export interface CourseScheduleSlot {
  id: string;
  course_id: string;
  day_of_week: DayOfWeek;
  start_period: number;
  end_period: number;
}

export interface SessionToken {
  session_id: string;
  qr_token: string;
  audio_nonce: string;
  expires_in: number; // seconds, ~15
  window_open: boolean;
  window_remaining: number;
}

// Final status, resolved at batchClose from the two timestamps:
// present (both), late (check_out only), early_leave (check_in only),
// absent (neither). `pending` until the session is closed.
export type AttendanceStatus =
  | "present"
  | "absent"
  | "late"
  | "early_leave"
  | "pending";

export type CheckPhase = "check_in" | "check_out";

export type VerifyStatus = "verified" | "pending" | "rejected";

export interface VerifyResult {
  status: VerifyStatus;
  cross_verified: boolean;
  device_matched: boolean;
  reason: VerifyReason | null;
  check_phase: CheckPhase | null; // set on success, null on rejection
  // Whether the student's attendance row has the 1차/2차 timestamp set after
  // this verify. The student UI shows 1차/2차 completion from these.
  check_in_done?: boolean;
  check_out_done?: boolean;
  risk_warning?: { level: "info" | "warning" | "danger"; absences: number; message: string } | null;
}

export interface VerifyRequest {
  session_id: string;
  qr_token: string;
  audio_nonce: string;
  device_uuid: string;
}

// Authenticated user profile (GET /auth/me). Lets the student client resolve
// its account id (for SSE) from the access token alone.
export interface UserOut {
  id: string;
  email: string;
  role: Role;
  name: string | null;
  student_id: string | null;
}

// Device binding result (POST /devices/register).
export interface DeviceBinding {
  account_id: string;
  device_uuid: string;
  bound_at: string;
}

// One row of the student's own attendance history (GET /me/attendance).
export interface MyAttendanceItem {
  record_id: string;
  session_id: string;
  course_id: string;
  course_name: string;
  week_number: number | null;
  status: AttendanceStatus;
  check_in_verified_at: string | null;
  check_out_verified_at: string | null;
  session_opened_at: string | null;
}

export interface AttendanceRecord {
  record_id: string;
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  check_in_verified_at: string | null;
  check_out_verified_at: string | null;
}

export interface AttendanceDelta {
  student_id: string;
  status: AttendanceStatus;
}

export interface UnverifiedStudent {
  student_id: string; // internal user id (UUID) — the Delta/batch key
  student_number?: string | null; // school 학번
  name?: string | null; // display name
}

// One enrolled student's per-phase state for the 결석자 검토 roster. The final
// status is derived from the two timestamps (present=both, early_leave=1차 only,
// late=2차 only, absent=neither); `pending` until the session is closed.
// check_in_done / check_out_done expose the raw 1차/2차 result so the review
// table can render each phase independently of the derived status.
export interface RosterStudent {
  student_id: string; // internal user id (UUID) — the Delta/batch key
  student_number?: string | null; // school 학번
  name?: string | null; // display name
  status: AttendanceStatus;
  check_in_done: boolean; // 1차 (check_in) timestamp present
  check_out_done: boolean; // 2차 (check_out) timestamp present
}

export interface AttendanceAggregate {
  session_id: string;
  total: number;
  present: number;
  absent: number;
  late: number; // resolved (closed session) only
  early_leave: number; // resolved (closed session) only
  unverified: UnverifiedStudent[]; // readable student summaries (backward compat)
  roster: RosterStudent[]; // full per-student roster with 1차/2차 state
}

// One enrolled student's per-week status across the semester (15 weeks).
export interface AttendanceMatrixStudent {
  student_id: string; // internal user id (UUID)
  student_number: string | null; // school 학번
  name: string | null;
  // Length 15, index 0 = week 1. null = no session held that week.
  weeks: (AttendanceStatus | null)[];
}

// Course-wide cumulative attendance matrix: students x 15 weeks.
export interface AttendanceMatrix {
  course_id: string;
  course_name: string | null;
  weeks: number[]; // week numbers (1..15) that have at least one session
  students: AttendanceMatrixStudent[];
}

export type VerifyReason =
  | "window_closed"
  | "not_enrolled"
  | "cross_verify_failed"
  | "nonce_reused"
  | "device_mismatch"
  | "duplicate_attendance";

// One verification scenario run during simulation (POST /sessions/{id}/simulate).
export interface SimulationCase {
  name: string;
  expected_rejected: boolean;
  expected_reason: VerifyReason | null;
  rejected: boolean;
  reason: VerifyReason | null;
  passed: boolean;
}

export interface SimulationResult {
  session_id: string;
  cases: SimulationCase[];
  cleaned_up: boolean;
}

export interface SimulateBotsRequest {
  count: number;
  present_ratio: number;
  delay_min: number;
  delay_max: number;
}

export interface SimulateBotsResult {
  course_id: string;
  total_bots: number;
  present: number;
  unverified: number;
}

export interface BotCleanupResult {
  course_id: string;
  removed: number;
  cleaned_up: boolean;
}

export interface ApiError {
  detail?: string;
  code?: string;
}
