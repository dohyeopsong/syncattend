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

// day_of_week: 1=Mon … 7=Sun (ISO-8601 weekday), null when unscheduled.
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

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

export interface Enrollment {
  course_id: string;
  student_id: string;
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

export interface AttendanceAggregate {
  session_id: string;
  total: number;
  present: number;
  unverified: string[]; // student_ids
}

export interface RiskWarning {
  level: "info" | "warning" | "danger";
  absences: number;
  message: string;
}

export interface ApiError {
  detail?: string;
  code?: string;
}
