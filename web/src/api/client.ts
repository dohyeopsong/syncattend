// Thin API client over the Vite proxy (/api -> backend :8000, /api stripped).
// All operationIds from contracts/openapi.yaml that the professor dashboard needs.

import type {
  AttendanceAggregate,
  AttendanceDelta,
  AttendanceMatrix,
  AttendanceRecord,
  AttendanceStatus,
  BotCleanupResult,
  Course,
  CourseCatalogItem,
  CreateCourseRequest,
  Enrollment,
  LoginRequest,
  MyAttendanceItem,
  MyCourseItem,
  RefreshRequest,
  RegisterUserRequest,
  RiskWarning,
  SendCodeRequest,
  Session,
  SessionEstimate,
  SessionToken,
  CourseScheduleSlot,
  SimulateBotsRequest,
  SimulateBotsResult,
  SimulationResult,
  TokenPair,
  UpdateCourseRequest,
  UserOut,
  VerifyCodeRequest,
  VerifyCodeResult,
  VerifyRequest,
  VerifyResult,
  DeviceBinding,
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

function readableApiMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
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

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ApiRequestError(
      0,
      detail === "The string did not match the expected pattern."
        ? "웹 API 요청 주소가 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 시도하세요."
        : detail,
    );
  }

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
      message = readableApiMessage(body.detail, message);
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

// Student browser login (iPhone Safari etc.). Same student-only gate as the
// mobile app, just transported over a browser session instead of the Flutter
// app — lets a student authenticate without installing anything.
export function loginStudent(payload: LoginRequest): Promise<TokenPair> {
  return request<TokenPair>("/auth/login", {
    method: "POST",
    headers: { "X-Client-Type": "student-web" },
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

// GET /courses/catalog?q= — complete browsable catalog. The optional `q`
// parameter remains available for callers that prefer server-side filtering;
// the timetable loads once and filters locally for instant search.
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

// Cumulative per-student × per-week attendance matrix (15 weeks).
export function getCourseAttendanceMatrix(
  courseId: string,
): Promise<AttendanceMatrix> {
  return request<AttendanceMatrix>(
    `/courses/${encodeURIComponent(courseId)}/attendance/matrix`,
  );
}

// ------------------------------------------------------------ sessions
export function createSession(
  courseId: string,
  opts?: {
    windowSeconds?: number;
    weekNumber?: number | null;
    scheduleId?: string | null;
  },
): Promise<Session> {
  const { windowSeconds = 60, weekNumber = null, scheduleId = null } = opts ?? {};
  return request<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      course_id: courseId,
      window_seconds: windowSeconds,
      week_number: weekNumber,
      schedule_id: scheduleId,
    }),
  });
}

// Pre-fill the open-session modal: estimated week + slot for the current time.
// Does NOT create a session — the professor confirms/edits then calls createSession.
export function estimateSession(courseId: string): Promise<SessionEstimate> {
  return request<SessionEstimate>("/sessions/estimate", {
    method: "POST",
    body: JSON.stringify({ course_id: courseId }),
  });
}

// All weekly slots of a course (for the open-session confirmation dropdown).
export function listCourseSchedules(
  courseId: string,
): Promise<CourseScheduleSlot[]> {
  return request<CourseScheduleSlot[]>(
    `/courses/${encodeURIComponent(courseId)}/schedules`,
  );
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

// Open the check_out (end-of-class) auth window: phase check_in → check_out,
// resets the active window. Optional windowSeconds overrides the default length.
export function openCheckout(
  sessionId: string,
  windowSeconds?: number,
): Promise<Session> {
  const body =
    windowSeconds != null ? { window_seconds: windowSeconds } : {};
  return request<Session>(
    `/sessions/${encodeURIComponent(sessionId)}/checkout`,
    { method: "POST", body: JSON.stringify(body) },
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

// ------------------------------------------------------ student (browser)
// The student browser auth path mirrors the Flutter app: register a device UUID
// (stored in localStorage for the browser — weaker than Keychain/Keystore, but
// the @wku.ac.kr re-registration gate still applies), then verify attendance
// with the QR token + decoded ultrasonic nonce.
export function getMe(): Promise<UserOut> {
  return request<UserOut>("/auth/me");
}

export function registerDevice(deviceUuid: string): Promise<DeviceBinding> {
  return request<DeviceBinding>("/devices/register", {
    method: "POST",
    body: JSON.stringify({ device_uuid: deviceUuid }),
  });
}

export function verifyAttendance(
  payload: VerifyRequest,
): Promise<VerifyResult> {
  return request<VerifyResult>("/attendance/verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getMyAttendance(): Promise<MyAttendanceItem[]> {
  return request<MyAttendanceItem[]>("/me/attendance");
}

// ------------------------------------------------------ student auth (web)
// Signup flow (send-code → verify-code → register) + device re-registration.
// Mirrors the Flutter app's auth_controller.dart; transported over the browser.
export function sendSignupCode(payload: SendCodeRequest): Promise<VerifyCodeResult> {
  return request<VerifyCodeResult>("/auth/send-code", {
    method: "POST",
    headers: { "X-Client-Type": "student-web" },
    body: JSON.stringify(payload),
  });
}

export function verifySignupCode(
  payload: VerifyCodeRequest,
): Promise<VerifyCodeResult> {
  return request<VerifyCodeResult>("/auth/verify-code", {
    method: "POST",
    headers: { "X-Client-Type": "student-web" },
    body: JSON.stringify(payload),
  });
}

export function registerUser(
  payload: RegisterUserRequest,
): Promise<UserOut> {
  return request<UserOut>("/auth/register", {
    method: "POST",
    headers: { "X-Client-Type": "student-web" },
    body: JSON.stringify(payload),
  });
}

// Device binding status (GET /devices/me). 404 = no binding yet, 401 = no/invalid
// token. Used by the student home bootstrap to decide register vs reauth vs ready.
export function getMyDevice(): Promise<DeviceBinding> {
  return request<DeviceBinding>("/devices/me");
}

export function confirmDevicePairing(code: string): Promise<DeviceBinding> {
  return request<DeviceBinding>("/devices/pairing/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

// Request a re-auth verification code to the given @wku.ac.kr email.
export function requestReauthCode(email: string): Promise<void> {
  return request<void>("/devices/reregister/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

// Confirm the re-auth code and rebind this device's UUID to the email account.
export function confirmReauth(
  email: string,
  code: string,
  newDeviceUuid: string,
): Promise<DeviceBinding> {
  return request<DeviceBinding>("/devices/reregister/confirm", {
    method: "POST",
    body: JSON.stringify({
      email,
      code,
      new_device_uuid: newDeviceUuid,
    }),
  });
}

// Courses the calling student is enrolled in — the timetable source.
export function listMyCourses(): Promise<MyCourseItem[]> {
  return request<MyCourseItem[]>("/me/courses");
}

// Student self-enroll / unenroll (the catalog's "담기" / "취소" buttons).
export function enrollSelf(courseId: string): Promise<Enrollment> {
  return request<Enrollment>(
    `/courses/${encodeURIComponent(courseId)}/enroll-self`,
    { method: "POST" },
  );
}

export function unenrollSelf(courseId: string): Promise<void> {
  return request<void>(
    `/courses/${encodeURIComponent(courseId)}/enroll-self`,
    { method: "DELETE" },
  );
}

// SSE risk-warning stream URL for the calling student. EventSource cannot set
// Authorization headers, so the access token is passed as a query param.
export function sseStudentUrl(studentId: string): string {
  const q = accessToken
    ? `?access_token=${encodeURIComponent(accessToken)}`
    : "";
  return `${BASE}/sse/students/${encodeURIComponent(studentId)}${q}`;
}

// Parse a single SSE `data:` frame into a RiskWarning, or null if the frame is
// a comment / keep-alive / malformed JSON. Shared by the risk banner hook.
export function parseRiskFrame(data: string): RiskWarning | null {
  const trimmed = data.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<RiskWarning>;
    if (
      obj.level &&
      obj.message != null &&
      typeof obj.absences === "number"
    ) {
      return {
        level: obj.level,
        absences: obj.absences,
        message: obj.message,
      };
    }
    return null;
  } catch {
    return null;
  }
}
