import { create } from "zustand";
import {
  closeSession as apiClose,
  createSession as apiCreate,
  extendWindow as apiExtend,
  getSessionToken as apiToken,
} from "@/api/client";
import type { Session, SessionToken } from "@/api/types";

interface SessionState {
  session: Session | null;
  token: SessionToken | null;
  error: string | null;
  pollTimer: ReturnType<typeof setInterval> | null;

  openSession: (courseId: string, windowSeconds?: number) => Promise<Session | null>;
  extend: (addSeconds?: number) => Promise<void>;
  close: () => Promise<void>;
  refreshToken: () => Promise<void>;
  startTokenPolling: (intervalMs?: number) => void;
  stopTokenPolling: () => void;
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

  openSession: async (courseId, windowSeconds = 60) => {
    set({ error: null });
    try {
      const session = await apiCreate(courseId, windowSeconds);
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

  close: async () => {
    const s = get().session;
    if (!s) return;
    get().stopTokenPolling();
    try {
      const session = await apiClose(s.session_id);
      set({ session });
    } catch (e) {
      set({ error: toMessage(e) });
    }
  },

  refreshToken: async () => {
    const s = get().session;
    if (!s) return;
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
      set({ error: toMessage(e) });
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

  reset: () => {
    get().stopTokenPolling();
    set({ session: null, token: null, error: null });
  },
}));
