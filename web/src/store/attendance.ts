import { create } from "zustand";
import {
  batchCloseAttendance as apiBatch,
  correctAttendance as apiCorrect,
  getSessionAttendance as apiAggregate,
  sseSessionUrl,
} from "@/api/client";
import type {
  AttendanceAggregate,
  AttendanceDelta,
  AttendanceStatus,
} from "@/api/types";

interface AttendanceState {
  aggregate: AttendanceAggregate | null;
  // Pending Delta corrections (student_id -> desired status), applied on batch close.
  pendingDeltas: Record<string, AttendanceStatus>;
  sseConnected: boolean;
  error: string | null;
  eventSource: EventSource | null;

  fetchAggregate: (sessionId: string) => Promise<void>;
  setDelta: (studentId: string, status: AttendanceStatus) => void;
  clearDelta: (studentId: string) => void;
  batchClose: (sessionId: string) => Promise<boolean>;
  correct: (recordId: string, status: AttendanceStatus) => Promise<boolean>;
  subscribeSse: (sessionId: string) => void;
  unsubscribeSse: () => void;
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

  batchClose: async (sessionId) => {
    const deltas: AttendanceDelta[] = Object.entries(get().pendingDeltas).map(
      ([student_id, status]) => ({ student_id, status }),
    );
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
    get().unsubscribeSse();
    set({ aggregate: null, pendingDeltas: {}, error: null });
  },
}));
