import { create } from "zustand";
import {
  closeSession as apiClose,
  createSession as apiCreate,
  extendWindow as apiExtend,
  getSessionToken as apiToken,
  openCheckout as apiCheckout,
} from "@/api/client";
import type { Session, SessionToken } from "@/api/types";

interface SessionState {
  session: Session | null;
  token: SessionToken | null;
  error: string | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  // 결석자 검토 팝업: 세션 닫기 또는 인증 창 만료(0s) 시 자동 오픈.
  reviewOpen: boolean;

  openSession: (
    courseId: string,
    opts?: { windowSeconds?: number; weekNumber?: number | null; scheduleId?: string | null },
  ) => Promise<Session | null>;
  extend: (addSeconds?: number) => Promise<void>;
  /** Open the check_out (end-of-class) auth window on the CURRENT session. */
  openCheckout: (windowSeconds?: number) => Promise<void>;
  /** Open check_out on a SPECIFIC session (2차 re-open from the open-session
   *  modal, which knows the pending_session_id from the estimate). */
  openCheckoutById: (sessionId: string, windowSeconds?: number) => Promise<void>;
  close: () => Promise<void>;
  refreshToken: () => Promise<void>;
  startTokenPolling: (intervalMs?: number) => void;
  stopTokenPolling: () => void;
  openReview: () => void;
  closeReview: () => void;
  reset: () => void;
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  token: null,
  error: null,
  pollTimer: null,
  reviewOpen: false,

  openSession: async (courseId, opts) => {
    const { windowSeconds = 60, weekNumber = null, scheduleId = null } = opts ?? {};
    set({ error: null });
    try {
      const session = await apiCreate(courseId, {
        windowSeconds,
        weekNumber,
        scheduleId,
      });
      set({ session });
      await get().refreshToken();
      return session;
    } catch (e) {
      set({ error: toMessage(e) });
      return null;
    }
  },

  extend: async (addSeconds = 60) => {
    const s = get().session;
    if (!s) return;
    try {
      const session = await apiExtend(s.session_id, addSeconds);
      set({ session });
    } catch (e) {
      set({ error: toMessage(e) });
    }
  },

  openCheckout: async (windowSeconds = 60) => {
    const s = get().session;
    if (!s) return;
    try {
      const session = await apiCheckout(s.session_id, windowSeconds);
      set({ session });
      // 새 인증 창이 열렸으니 토큰/카운트다인 동기화.
      await get().refreshToken();
    } catch (e) {
      set({ error: toMessage(e) });
    }
  },

  openCheckoutById: async (sessionId, windowSeconds = 60) => {
    set({ error: null });
    try {
      const session = await apiCheckout(sessionId, windowSeconds);
      set({ session });
      await get().refreshToken();
    } catch (e) {
      set({ error: toMessage(e) });
    }
  },

  close: async () => {
    const s = get().session;
    if (!s) return;
    get().stopTokenPolling();
    // Optimistically close locally FIRST so the QR/audio stops immediately and
    // the review popup opens — even if the backend call is slow or fails. The
    // server-side close is best-effort; if it errors we still transition the UI
    // (the professor already decided to end the round).
    set((state) => ({
      session: state.session
        ? { ...state.session, phase: "closed", window_open: false, window_remaining: 0 }
        : state.session,
      token: null,
      reviewOpen: true,
    }));
    try {
      const session = await apiClose(s.session_id);
      set({ session });
    } catch {
      // Backend close failed — the UI already transitioned above. Leave the
      // local closed state; the professor can re-open for 2차 later.
    }
  },

  refreshToken: async () => {
    const s = get().session;
    if (!s) return;
    // closed 세션에서는 토큰을 발급하지 않는다 (백엔드가 409를 반환).
    // 폴링이 중지되지 않은 채로 close가 완료된 직후 한 번 더 호출되는 것을 방지.
    if (s.phase === "closed") {
      set({ token: null });
      return;
    }
    try {
      const token = await apiToken(s.session_id);
      // Keep the session window state in sync with the token payload.
      set((state) => ({
        token,
        session: state.session
          ? {
              ...state.session,
              window_open: token.window_open,
              window_remaining: token.window_remaining,
            }
          : state.session,
      }));
    } catch (e) {
      // 409 (session closed) → 토큰 폐기. 다른 에러는 표시.
      set({ token: null, error: toMessage(e) });
    }
  },

  startTokenPolling: (intervalMs = 5000) => {
    get().stopTokenPolling();
    const timer = setInterval(() => {
      void get().refreshToken();
    }, intervalMs);
    set({ pollTimer: timer });
  },

  stopTokenPolling: () => {
    const t = get().pollTimer;
    if (t) clearInterval(t);
    set({ pollTimer: null });
  },

  openReview: () => set({ reviewOpen: true }),
  closeReview: () => set({ reviewOpen: false }),

  reset: () => {
    get().stopTokenPolling();
    set({ session: null, token: null, error: null, reviewOpen: false });
  },
}));
