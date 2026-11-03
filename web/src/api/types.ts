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
  created_at: string;
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
  window_open: boolean;
  window_remaining: number; // seconds
  status: "open" | "closed";
}

export interface SessionToken {
  session_id: string;
  qr_token: string;
  audio_nonce: string;
  expires_in: number; // seconds, ~15
  window_open: boolean;
  window_remaining: number;
}

export type AttendanceStatus = "present" | "absent" | "pending";

export interface AttendanceRecord {
  record_id: string;
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  verified_at: string | null;
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

export interface AttendanceAggregate {
  session_id: string;
  total: number;
  present: number;
  absent: number;
  unverified: UnverifiedStudent[]; // readable student summaries, not raw UUIDs
}

export type VerifyReason =
  | "window_closed"
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
