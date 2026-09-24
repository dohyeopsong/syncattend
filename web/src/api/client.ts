// Thin API client over the Vite proxy (/api -> backend :8000, /api stripped).
// All operationIds from contracts/openapi.yaml that the professor dashboard needs.

import type {
  AttendanceAggregate,
  AttendanceDelta,
  AttendanceRecord,
  AttendanceStatus,
  Course,
  CourseCatalogItem,
  CreateCourseRequest,
  Enrollment,
  LoginRequest,
  Session,
  SessionToken,
  TokenPair,
  UpdateCourseRequest,
} from "./types";

const BASE = "/api";

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body.detail ?? message;
      code = body.code;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiRequestError(res.status, message, code);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- auth
export function login(payload: LoginRequest): Promise<TokenPair> {
  return request<TokenPair>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ------------------------------------------------------------- courses
export function createCourse(payload: CreateCourseRequest): Promise<Course> {
  return request<Course>("/courses", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listCourses(): Promise<Course[]> {
  return request<Course[]>("/courses");
}

// GET /courses/catalog?q= — browsable catalog for autocomplete. The `q` search
// param is additive; if the backend does not yet filter, callers filter
// client-side. Encodes q only when non-empty to keep the URL clean.
export function listCourseCatalog(q?: string): Promise<CourseCatalogItem[]> {
  const query = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return request<CourseCatalogItem[]>(`/courses/catalog${query}`);
}

// PATCH /courses/{course_id} — partial update of schedule/metadata fields.
export function updateCourse(
  courseId: string,
  payload: UpdateCourseRequest,
): Promise<Course> {
  return request<Course>(`/courses/${encodeURIComponent(courseId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// DELETE /courses/{course_id} — irreversible; UI must confirm first.
export function deleteCourse(courseId: string): Promise<void> {
  return request<void>(`/courses/${encodeURIComponent(courseId)}`, {
    method: "DELETE",
  });
}

export function enrollStudent(
  courseId: string,
  studentId: string,
): Promise<Enrollment> {
  return request<Enrollment>(
    `/courses/${encodeURIComponent(courseId)}/enrollments`,
    {
      method: "POST",
      body: JSON.stringify({ student_id: studentId }),
    },
  );
}

export function listEnrollments(courseId: string): Promise<Enrollment[]> {
  return request<Enrollment[]>(
    `/courses/${encodeURIComponent(courseId)}/enrollments`,
  );
}

// ------------------------------------------------------------ sessions
export function createSession(
  courseId: string,
  windowSeconds = 60,
): Promise<Session> {
  return request<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify({ course_id: courseId, window_seconds: windowSeconds }),
  });
}

export function extendWindow(
  sessionId: string,
  addSeconds = 60,
): Promise<Session> {
  return request<Session>(
    `/sessions/${encodeURIComponent(sessionId)}/window/extend`,
    {
      method: "POST",
      body: JSON.stringify({ add_seconds: addSeconds }),
    },
  );
}

export function closeSession(sessionId: string): Promise<Session> {
  return request<Session>(
    `/sessions/${encodeURIComponent(sessionId)}/close`,
    { method: "POST" },
  );
}

export function getSessionToken(sessionId: string): Promise<SessionToken> {
  return request<SessionToken>(
    `/sessions/${encodeURIComponent(sessionId)}/token`,
  );
}

// ---------------------------------------------------------- attendance
export function getSessionAttendance(
  sessionId: string,
): Promise<AttendanceAggregate> {
  return request<AttendanceAggregate>(
    `/sessions/${encodeURIComponent(sessionId)}/attendance`,
  );
}

export function batchCloseAttendance(
  sessionId: string,
  deltas: AttendanceDelta[],
): Promise<AttendanceAggregate> {
  return request<AttendanceAggregate>(
    `/sessions/${encodeURIComponent(sessionId)}/attendance/batch`,
    {
      method: "POST",
      body: JSON.stringify({ deltas }),
    },
  );
}

export function correctAttendance(
  recordId: string,
  status: AttendanceStatus,
): Promise<AttendanceRecord> {
  return request<AttendanceRecord>(
    `/attendance/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
}

// ---------------------------------------------------------------- sse
// SSE cannot set Authorization headers via EventSource; pass token as query.
// Backend (owner A) accepts ?access_token= for the stream endpoints.
export function sseSessionUrl(sessionId: string): string {
  const q = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : "";
  return `${BASE}/sse/sessions/${encodeURIComponent(sessionId)}${q}`;
}
