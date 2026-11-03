// Thin API client over the Vite proxy (/api -> backend :8000, /api stripped).
// All operationIds from contracts/openapi.yaml that the professor dashboard needs.

import type {
  AttendanceAggregate,
  AttendanceDelta,
  AttendanceRecord,
  AttendanceStatus,
  BotCleanupResult,
  Course,
  CourseCatalogItem,
  CreateCourseRequest,
  Enrollment,
  LoginRequest,
  RefreshRequest,
  Session,
  SessionToken,
  SimulateBotsRequest,
  SimulateBotsResult,
  SimulationResult,
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

/**
 * Refresh callback wired in by the auth store at hydrate() time. The store owns
 * token persistence + the sessionExpired flag; the client only calls this on a
 * 401 to transparently renew the access token. Keeping it as a registered
 * callback (rather than importing the store directly) avoids an import cycle:
 * the store imports the client, not the reverse.
 */
type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;

export function setRefreshHandler(handler: RefreshHandler | null) {
  refreshHandler = handler;
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

/** Tracks an in-flight refresh so concurrent 401s share a single renewal. */
let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  if (!refreshHandler) return null;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshHandler().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
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

  let res = await fetch(`${BASE}${path}`, { ...options, headers });

  // 401 → try to refresh the access token ONCE, then replay the original
  // request with the new token. If refresh fails (refresh token also expired),
  // the handler flips sessionExpired and we surface the 401 to the caller; the
  // app shell shows a re-login banner. We do not retry /auth/refresh itself.
  if (
    res.status === 401 &&
    !path.startsWith("/auth/refresh") &&
    !path.startsWith("/auth/login")
  ) {
    const renewed = await doRefresh();
    if (renewed) {
      const retryHeaders = new Headers(options.headers);
      if (!retryHeaders.has("Content-Type") && options.body) {
        retryHeaders.set("Content-Type", "application/json");
      }
      retryHeaders.set("Authorization", `Bearer ${renewed}`);
      res = await fetch(`${BASE}${path}`, { ...options, headers: retryHeaders });
    }
  }

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
// The web dashboard is professor-only; the mobile app is student-only. The
// client declares itself with X-Client-Type so the backend can reject a role
// mismatch at login (e.g. a student logging into the web) — the guard cannot
// be bypassed by calling the API directly without the UI check.
export function login(payload: LoginRequest): Promise<TokenPair> {
  return request<TokenPair>("/auth/login", {
    method: "POST",
    headers: { "X-Client-Type": "web" },
    body: JSON.stringify(payload),
  });
}

export function refreshTokenApi(refreshToken: string): Promise<TokenPair> {
  const payload: RefreshRequest = { refresh_token: refreshToken };
  return request<TokenPair>("/auth/refresh", {
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

// Virtual attendance simulation: runs every verify case (normal / window-closed /
// cross-fail / device-mismatch / duplicate) through the REAL backend path using
// synthetic students, then cleans up. Professor-only.
export function simulateAttendance(sessionId: string): Promise<SimulationResult> {
  return request<SimulationResult>(
    `/sessions/${encodeURIComponent(sessionId)}/simulate`,
    { method: "POST" },
  );
}

// Populate the dashboard with virtual bot students so the professor can test
// realtime monitoring (SSE), stat cards, and 출석 마감 without real students.
// Bots are COURSE-scoped: `count` bots are enrolled in the course synchronously
// (미인증, visible in the roster immediately); `present_ratio` verify (present)
// once a session opens, after a random delay. Data is NOT cleaned up — call
// cleanupBots(). Professor-only; course owned by the caller.
export function simulateBots(
  courseId: string,
  payload: SimulateBotsRequest,
): Promise<SimulateBotsResult> {
  return request<SimulateBotsResult>(
    `/courses/${encodeURIComponent(courseId)}/simulate-bots`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

// Remove all virtual bot students (and their devices/enrollments/attendance)
// so the dashboard returns to real data. Course-scoped; removes ALL bots at once.
export function cleanupBots(courseId: string): Promise<BotCleanupResult> {
  return request<BotCleanupResult>(
    `/courses/${encodeURIComponent(courseId)}/simulate-bots`,
    { method: "DELETE" },
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

// Download a session's full attendance roster as a JSON file (archival / export).
export function exportSessionAttendanceUrl(sessionId: string): string {
  const q = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : "";
  return `${BASE}/sessions/${encodeURIComponent(sessionId)}/attendance/export${q}`;
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
