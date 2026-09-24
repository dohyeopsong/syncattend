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
type Handler = (
  body: any,
  query?: Record<string, string>,
) => { status: number; json: any };

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
        code: b.code ?? null,
        department: b.department ?? null,
        professor_name: b.professor_name ?? null,
        day_of_week: b.day_of_week ?? null,
        start_period: b.start_period ?? null,
        end_period: b.end_period ?? null,
        location: b.location ?? null,
        credits: b.credits ?? null,
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
          code: "SW3001",
          department: "소프트웨어학과",
          professor_name: "홍길동",
          day_of_week: 1,
          start_period: 1,
          end_period: 3,
          location: "공학관 401",
          credits: 3,
          created_at: "2026-09-25T00:00:00Z",
        },
      ],
    }),
    "PATCH /courses/course-1": (b) => ({
      status: 200,
      json: {
        id: "course-1",
        professor_id: "prof-1",
        name: b.name ?? "소프트웨어공학",
        code: b.code ?? "SW3001",
        department: b.department ?? "소프트웨어학과",
        professor_name: b.professor_name ?? "홍길동",
        day_of_week: b.day_of_week ?? 1,
        start_period: b.start_period ?? 1,
        end_period: b.end_period ?? 3,
        location: b.location ?? "공학관 401",
        credits: b.credits ?? 3,
        created_at: "2026-09-25T00:00:00Z",
      },
    }),
    "DELETE /courses/course-1": () => ({ status: 204, json: null }),
    "GET /courses/catalog": (_b, query) => {
      const all = [
        {
          id: "cat-1",
          professor_id: "prof-9",
          name: "운영체제",
          code: "SW3010",
          department: "소프트웨어학과",
          professor_name: "이영희",
          day_of_week: 2,
          start_period: 3,
          end_period: 4,
          location: "공학관 210",
          credits: 3,
          enrolled: false,
        },
        {
          id: "cat-2",
          professor_id: "prof-8",
          name: "컴퓨터네트워크",
          code: "SW3020",
          department: "소프트웨어학과",
          professor_name: "박철수",
          day_of_week: 4,
          start_period: 5,
          end_period: 6,
          location: "공학관 220",
          credits: 3,
          enrolled: false,
        },
      ];
      const q = (query?.q ?? "").toLowerCase();
      const json = q
        ? all.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              c.professor_name.toLowerCase().includes(q) ||
              (c.code ?? "").toLowerCase().includes(q),
          )
        : all;
      return { status: 200, json };
    },
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
    const full = url.replace(/^\/api/, "");
    const [path, queryString = ""] = full.split("?");
    const query = Object.fromEntries(new URLSearchParams(queryString));
    const key = `${method} ${path}`;
    const handler = backend.routes[key];
    if (!handler) {
      return new Response(JSON.stringify({ detail: `no route ${key}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const { status, json } = handler(body, query);
    if (status === 204) {
      return new Response(null, { status: 204 });
    }
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
  useCoursesStore.setState({
    courses: [],
    enrollments: {},
    error: null,
    catalog: [],
    catalogLoading: false,
  });
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
    const course = await useCoursesStore
      .getState()
      .addCourse({ name: "소프트웨어공학" });
    expect(course?.id).toBe("course-1");
    await useCoursesStore.getState().fetchCourses();
    expect(useCoursesStore.getState().courses).toHaveLength(1);
    expect(useCoursesStore.getState().courses[0].code).toBe("SW3001");

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

describe("course management CRUD (web client + store)", () => {
  it("adds a course with schedule fields", async () => {
    installFetch(makeBackend());
    const created = await useCoursesStore.getState().addCourse({
      name: "자료구조",
      code: "SW2001",
      department: "소프트웨어학과",
      professor_name: "김교수",
      day_of_week: 3,
      start_period: 4,
      end_period: 6,
      location: "공학관 302",
      credits: 3,
    });
    expect(created?.id).toBe("course-1");
    // mock echoes payload → schedule fields round-trip through the client
    expect(created?.code).toBe("SW2001");
    expect(created?.day_of_week).toBe(3);
    expect(created?.start_period).toBe(4);
    expect(created?.credits).toBe(3);
    expect(useCoursesStore.getState().courses).toHaveLength(1);
  });

  it("updates a course via PATCH and replaces it in the store", async () => {
    installFetch(makeBackend());
    await useCoursesStore.getState().fetchCourses();
    expect(useCoursesStore.getState().courses[0].location).toBe("공학관 401");

    const updated = await useCoursesStore
      .getState()
      .updateCourse("course-1", { location: "공학관 505", credits: 2 });
    expect(updated?.location).toBe("공학관 505");
    expect(updated?.credits).toBe(2);
    // store reflects the patched course (same id, new fields)
    const inStore = useCoursesStore.getState().courses.find((c) => c.id === "course-1");
    expect(inStore?.location).toBe("공학관 505");
    expect(inStore?.credits).toBe(2);
    expect(useCoursesStore.getState().courses).toHaveLength(1);
  });

  it("deletes a course (DELETE 204) and removes it from the store", async () => {
    installFetch(makeBackend());
    await useCoursesStore.getState().fetchCourses();
    expect(useCoursesStore.getState().courses).toHaveLength(1);

    const ok = await useCoursesStore.getState().deleteCourse("course-1");
    expect(ok).toBe(true);
    expect(useCoursesStore.getState().courses).toHaveLength(0);
    expect(useCoursesStore.getState().error).toBeNull();
  });

  it("surfaces a delete failure as a store error and keeps the course", async () => {
    // backend with no DELETE route → 404 → store error, course retained
    const backend = makeBackend();
    delete backend.routes["DELETE /courses/course-1"];
    installFetch(backend);
    await useCoursesStore.getState().fetchCourses();
    const ok = await useCoursesStore.getState().deleteCourse("course-1");
    expect(ok).toBe(false);
    expect(useCoursesStore.getState().error).toBeTruthy();
    expect(useCoursesStore.getState().courses).toHaveLength(1);
  });
});

describe("catalog autocomplete search (web client + store)", () => {
  it("searchCatalog(q) returns matching candidates with schedule fields", async () => {
    installFetch(makeBackend());
    await useCoursesStore.getState().searchCatalog("운영");
    const catalog = useCoursesStore.getState().catalog;
    expect(catalog).toHaveLength(1);
    const hit = catalog[0];
    expect(hit.name).toBe("운영체제");
    // schedule fields present → the combobox can auto-fill the add form
    expect(hit.code).toBe("SW3010");
    expect(hit.professor_name).toBe("이영희");
    expect(hit.department).toBe("소프트웨어학과");
    expect(hit.day_of_week).toBe(2);
    expect(hit.start_period).toBe(3);
    expect(hit.end_period).toBe(4);
    expect(hit.credits).toBe(3);
  });

  it("matches by professor name too", async () => {
    installFetch(makeBackend());
    await useCoursesStore.getState().searchCatalog("박철수");
    const catalog = useCoursesStore.getState().catalog;
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe("컴퓨터네트워크");
  });

  it("blank query clears results without a request", async () => {
    const fetchFn = installFetch(makeBackend());
    await useCoursesStore.getState().searchCatalog("   ");
    expect(useCoursesStore.getState().catalog).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("selecting a candidate produces a create payload that round-trips", async () => {
    // Simulates the combobox → auto-fill → createCourse path end-to-end.
    installFetch(makeBackend());
    await useCoursesStore.getState().searchCatalog("네트워크");
    const item = useCoursesStore.getState().catalog[0];
    expect(item.name).toBe("컴퓨터네트워크");
    // auto-fill maps catalog item → CreateCourseRequest (professor adjusts day/period)
    const created = await useCoursesStore.getState().addCourse({
      name: item.name,
      code: item.code,
      department: item.department,
      professor_name: item.professor_name,
      day_of_week: item.day_of_week,
      start_period: item.start_period,
      end_period: item.end_period,
      location: item.location,
      credits: item.credits,
    });
    // POST /courses mock echoes payload → fields preserved through the client
    expect(created?.code).toBe("SW3020");
    expect(created?.professor_name).toBe("박철수");
    expect(created?.start_period).toBe(5);
    expect(created?.end_period).toBe(6);
  });
});
