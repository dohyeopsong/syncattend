// Professor-flow integration test (web side). Drives the real API client +
// Zustand stores through the full happy path and the documented rejection
// reasons, using a contract-shaped mock of `fetch` (no backend needed — CI
// runnable). This complements the live-stack E2E, which is currently blocked by
// a backend ORM/schema type mismatch (see infra/README.md "Integration E2E").
//
// Covers operationIds: login, createCourse, listCourses, enrollStudent,
// listEnrollments, createSession, getSessionToken, extendWindow, closeSession,
// getSessionAttendance, correctAttendance, batchCloseAttendance.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { useCoursesStore } from "@/store/courses";
import { useSessionStore } from "@/store/session";
import { useAttendanceStore } from "@/store/attendance";

// ---- contract-shaped in-memory backend ----
type Handler = (body: any) => { status: number; json: any };

function makeBackend() {
  const state = {
    sessionOpen: true,
    windowRemaining: 60,
    corrections: [] as { student_id: string; status: string }[],
  };

  const routes: Record<string, Handler> = {
    "POST /auth/login": () => ({
      status: 200,
      json: {
        access_token: "acc.jwt",
        refresh_token: "ref.jwt",
        token_type: "bearer",
        role: "professor",
      },
    }),
    "POST /courses": (b) => ({
      status: 201,
      json: {
        id: "course-1",
        professor_id: "prof-1",
        name: b.name,
        created_at: "2026-09-25T00:00:00Z",
      },
    }),
    "GET /courses": () => ({
      status: 200,
      json: [
        {
          id: "course-1",
          professor_id: "prof-1",
          name: "소프트웨어공학",
          created_at: "2026-09-25T00:00:00Z",
        },
      ],
    }),
    "POST /courses/course-1/enrollments": (b) => ({
      status: 201,
      json: { course_id: "course-1", student_id: b.student_id },
    }),
    "GET /courses/course-1/enrollments": () => ({
      status: 200,
      json: [{ course_id: "course-1", student_id: "stu-1" }],
    }),
    "POST /sessions": () => ({
      status: 201,
      json: {
        session_id: "sess-1",
        course_id: "course-1",
        window_open: true,
        window_remaining: 60,
        status: "open",
      },
    }),
    "GET /sessions/sess-1/token": () => ({
      status: 200,
      json: {
        session_id: "sess-1",
        qr_token: "qr-abc",
        audio_nonce: "1a2b3c4d",
        expires_in: 15,
        window_open: state.sessionOpen,
        window_remaining: state.windowRemaining,
      },
    }),
    "POST /sessions/sess-1/window/extend": () => {
      state.windowRemaining += 60;
      return {
        status: 200,
        json: {
          session_id: "sess-1",
          course_id: "course-1",
          window_open: true,
          window_remaining: state.windowRemaining,
          status: "open",
        },
      };
    },
    "POST /sessions/sess-1/close": () => {
      state.sessionOpen = false;
      state.windowRemaining = 0;
      return {
        status: 200,
        json: {
          session_id: "sess-1",
          course_id: "course-1",
          window_open: false,
          window_remaining: 0,
          status: "closed",
        },
      };
    },
    "GET /sessions/sess-1/attendance": () => ({
      status: 200,
      json: {
        session_id: "sess-1",
        total: 3,
        present: 1,
        unverified: ["stu-2", "stu-3"],
      },
    }),
    "PATCH /attendance/rec-1": (b) => ({
      status: 200,
      json: {
        record_id: "rec-1",
        session_id: "sess-1",
        student_id: "stu-2",
        status: b.status,
        verified_at: null,
      },
    }),
    "POST /sessions/sess-1/attendance/batch": (b) => {
      state.corrections = b.deltas;
      return {
        status: 200,
        json: {
          session_id: "sess-1",
          total: 3,
          present: 1 + b.deltas.filter((d: any) => d.status === "present").length,
          unverified: [],
        },
      };
    },
  };

  const backend = { state, routes };
  return backend;
}

function installFetch(backend: ReturnType<typeof makeBackend>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace(/^\/api/, "");
    const key = `${method} ${path}`;
    const handler = backend.routes[key];
    if (!handler) {
      return new Response(JSON.stringify({ detail: `no route ${key}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const { status, json } = handler(body);
    return new Response(JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  // jsdom-less env: provide a minimal localStorage BEFORE touching stores.
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => (store[k] = v),
    removeItem: (k: string) => delete store[k],
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
  // reset stores
  useAuthStore.getState().logout();
  useSessionStore.getState().reset();
  useAttendanceStore.getState().reset();
  useCoursesStore.setState({ courses: [], enrollments: {}, error: null });
  api.setAccessToken(null);
});

afterEach(() => vi.unstubAllGlobals());

describe("professor happy-path E2E (web client + stores)", () => {
  it("login → course → enroll → session → token → correct → batch close", async () => {
    installFetch(makeBackend());

    // 1) login
    const ok = await useAuthStore.getState().login("prof@wku.ac.kr", "supersecret");
    expect(ok).toBe(true);
    expect(useAuthStore.getState().role).toBe("professor");
    expect(api.getAccessToken()).toBe("acc.jwt");

    // create + list course
    const course = await useCoursesStore.getState().addCourse("소프트웨어공학");
    expect(course?.id).toBe("course-1");
    await useCoursesStore.getState().fetchCourses();
    expect(useCoursesStore.getState().courses).toHaveLength(1);

    // enroll + list enrollments
    const enrolled = await useCoursesStore.getState().enroll("course-1", "stu-1");
    expect(enrolled).toBe(true);
    await useCoursesStore.getState().fetchEnrollments("course-1");
    expect(useCoursesStore.getState().enrollments["course-1"]).toHaveLength(1);

    // 2) open session + poll token (audio nonce present)
    const session = await useSessionStore
      .getState()
      .openSession("course-1", 60);
    expect(session?.session_id).toBe("sess-1");
    expect(useSessionStore.getState().token?.audio_nonce).toBe("1a2b3c4d");
    expect(useSessionStore.getState().token?.expires_in).toBe(15);

    // 3) attendance aggregate (opt-out unverified list)
    await useAttendanceStore.getState().fetchAggregate("sess-1");
    const agg = useAttendanceStore.getState().aggregate!;
    expect(agg.total).toBe(3);
    expect(agg.present).toBe(1);
    expect(agg.unverified).toEqual(["stu-2", "stu-3"]);
    // privacy: aggregate exposes only counts + student ids, no location fields
    expect(Object.keys(agg).sort()).toEqual(
      ["present", "session_id", "total", "unverified"].sort(),
    );

    // 4) correct one record + queue delta + batch close
    const corrected = await useAttendanceStore
      .getState()
      .correct("rec-1", "present");
    expect(corrected).toBe(true);
    useAttendanceStore.getState().setDelta("stu-2", "present");
    useAttendanceStore.getState().setDelta("stu-3", "absent");
    const closed = await useAttendanceStore.getState().batchClose("sess-1");
    expect(closed).toBe(true);
    // deltas cleared after batch close, aggregate updated
    expect(Object.keys(useAttendanceStore.getState().pendingDeltas)).toHaveLength(0);
    expect(useAttendanceStore.getState().aggregate?.unverified).toEqual([]);

    // extend then close the window
    await useSessionStore.getState().extend(60);
    expect(useSessionStore.getState().session?.window_remaining).toBe(120);
    await useSessionStore.getState().close();
    expect(useSessionStore.getState().session?.status).toBe("closed");
  });
});

describe("rejection reasons surface as errors", () => {
  const reasons = [
    { status: 401, detail: "invalid credentials" },
    { status: 409, detail: "duplicate_attendance" },
  ];
  for (const r of reasons) {
    it(`maps HTTP ${r.status} to a client error ("${r.detail}")`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ detail: r.detail }), {
              status: r.status,
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );
      await expect(
        api.login({ email: "x@wku.ac.kr", password: "supersecret" }),
      ).rejects.toMatchObject({ status: r.status, message: r.detail });
    });
  }

  it("window_closed: getSessionToken shows window_open=false after close", async () => {
    const backend = makeBackend();
    backend.state.sessionOpen = false;
    backend.state.windowRemaining = 0;
    installFetch(backend);
    const token = await api.getSessionToken("sess-1");
    expect(token.window_open).toBe(false);
    expect(token.window_remaining).toBe(0);
  });
});
