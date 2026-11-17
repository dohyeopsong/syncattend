import { create } from "zustand";
import {
  batchCloseAttendance as apiBatch,
  correctAttendance as apiCorrect,
  getCourseAttendanceMatrix as apiMatrix,
  getSessionAttendance as apiAggregate,
  sseSessionUrl,
} from "@/api/client";
import type {
  AttendanceAggregate,
  AttendanceDelta,
  AttendanceStatus,
} from "@/api/types";
import { matrixToRows, type StudentRow } from "@/lib/attendanceMatrix";

interface AttendanceState {
  aggregate: AttendanceAggregate | null;
  // Pending Delta corrections (student_id -> desired status), applied on batch close.
  pendingDeltas: Record<string, AttendanceStatus>;
  sseConnected: boolean;
  error: string | null;
  eventSource: EventSource | null;

  // Course-wide cumulative attendance matrix (students × 15 weeks) for the
  // F-grade risk panel + weekly trend chart. Course-scoped: fetchMatrix loads
  // for one course and is shared by both panels so they stay in sync and only
  // fetch once per course.
  matrix: StudentRow[] | null;
  matrixCourseId: string | null;
  matrixLoading: boolean;
  matrixError: string | null;

  fetchAggregate: (sessionId: string) => Promise<void>;
  setDelta: (studentId: string, status: AttendanceStatus) => void;
  clearDelta: (studentId: string) => void;
  batchClose: (
    sessionId: string,
    deltas?: AttendanceDelta[],
  ) => Promise<boolean>;
  correct: (recordId: string, status: AttendanceStatus) => Promise<boolean>;
  subscribeSse: (sessionId: string) => void;
  unsubscribeSse: () => void;
  fetchMatrix: (courseId: string, force?: boolean) => Promise<void>;
  reset: () => void;
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  aggregate: null,
  pendingDeltas: {},
  sseConnected: false,
  error: null,
  eventSource: null,
  matrix: null,
  matrixCourseId: null,
  matrixLoading: false,
  matrixError: null,

  fetchAggregate: async (sessionId) => {
    set({ error: null });
    try {
      const aggregate = await apiAggregate(sessionId);
      set({ aggregate });
    } catch (e) {
      set({ error: toMessage(e) });
    }
  },

  setDelta: (studentId, status) => {
    set({ pendingDeltas: { ...get().pendingDeltas, [studentId]: status } });
  },

  clearDelta: (studentId) => {
    const next = { ...get().pendingDeltas };
    delete next[studentId];
    set({ pendingDeltas: next });
  },

  batchClose: async (sessionId, explicitDeltas) => {
    const deltas =
      explicitDeltas ??
      Object.entries(get().pendingDeltas).map(([student_id, status]) => ({
        student_id,
        status,
      }));
    // Always call the endpoint — even with no explicit deltas, the backend
    // auto-fails every unverified (pending) student to absent at close time
    // ("대기 없음" policy). Skipping would leave pending students unverified.
    try {
      const aggregate = await apiBatch(sessionId, deltas);
      set({ aggregate, pendingDeltas: {} });
      return true;
    } catch (e) {
      set({ error: toMessage(e) });
      return false;
    }
  },

  correct: async (recordId, status) => {
    try {
      await apiCorrect(recordId, status);
      return true;
    } catch (e) {
      set({ error: toMessage(e) });
      return false;
    }
  },

  subscribeSse: (sessionId) => {
    get().unsubscribeSse();
    try {
      const es = new EventSource(sseSessionUrl(sessionId));
      // The server emits a NAMED event ("event: attendance"), NOT a default
      // message event. EventSource.onmessage only fires for unnamed/default
      // events, so we MUST listen on the named channel — otherwise the
      // connection opens but the aggregate never updates and the realtime
      // panel stays empty for the whole open session. Keep onmessage too as a
      // fallback for any unnamed frame.
      const apply = (raw: string) => {
        try {
          const data = JSON.parse(raw) as AttendanceAggregate;
          set({ aggregate: data });
        } catch {
          // ignore malformed frame
        }
      };
      es.addEventListener("attendance", (ev) =>
        apply((ev as MessageEvent).data),
      );
      es.onmessage = (ev) => apply(ev.data);
      es.onopen = () => set({ sseConnected: true });
      es.onerror = () => set({ sseConnected: false });
      set({ eventSource: es });
    } catch (e) {
      set({ error: toMessage(e) });
    }
  },

  unsubscribeSse: () => {
    const es = get().eventSource;
    if (es) es.close();
    set({ eventSource: null, sseConnected: false });
  },

  reset: () => {
    // Reset the CURRENT session's live state (aggregate / SSE / deltas) but
    // KEEP the course-wide matrix. The matrix is cumulative across the whole
    // semester and is independent of whichever session is open — clearing it
    // here made the F-risk panel blank out every time the professor opened a
    // new session, which looked like the course selection had been lost.
    get().unsubscribeSse();
    set({
      aggregate: null,
      pendingDeltas: {},
      error: null,
    });
  },

  fetchMatrix: async (courseId, force = false) => {
    // Skip if already loaded (or loading) for the same course unless forced.
    // Both RiskGraphPanel and AbsenceRankChart call this on mount; the guard
    // avoids a duplicate request when both mount together.
    const st = get();
    if (!force && st.matrixCourseId === courseId && (st.matrix || st.matrixLoading)) {
      return;
    }
    set({ matrixLoading: true, matrixError: null });
    try {
      const resp = await apiMatrix(courseId);
      set({
        matrix: matrixToRows(resp),
        matrixCourseId: courseId,
        matrixLoading: false,
      });
    } catch (e) {
      set({ matrixLoading: false, matrixError: toMessage(e) });
    }
  },
}));
