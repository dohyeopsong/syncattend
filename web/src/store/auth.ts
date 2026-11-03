import { create } from "zustand";
import {
  login as apiLogin,
  refreshTokenApi,
  setAccessToken,
  setRefreshHandler,
} from "@/api/client";
import type { Role } from "@/api/types";

const STORAGE_KEY = "syncattend.auth";

interface PersistedAuth {
  accessToken: string;
  refreshToken: string;
  role: Role;
  email: string;
}

function loadPersisted(): PersistedAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedAuth;
  } catch {
    return null;
  }
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  role: Role | null;
  email: string | null;
  status: "idle" | "loading" | "error";
  error: string | null;
  /** Set when the access token expired and refresh also failed — the UI shows a
   * re-login banner and the next call will redirect to /login. */
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  hydrate: () => void;
  /** Called by the API client after a 401 + failed refresh. */
  markSessionExpired: () => void;
  /** Called when the API client refreshes the token successfully. */
  setTokens: (access: string, refresh: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshToken: null,
  role: null,
  email: null,
  status: "idle",
  error: null,
  sessionExpired: false,

  hydrate: () => {
    const persisted = loadPersisted();
    if (persisted) {
      // Refuse to restore a non-professor session on the web dashboard.
      if (persisted.role !== "professor") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        setAccessToken(persisted.accessToken);
        set({
          accessToken: persisted.accessToken,
          refreshToken: persisted.refreshToken,
          role: persisted.role,
          email: persisted.email,
          sessionExpired: false,
        });
      }
    }
    // Wire the refresh callback so the API client can renew tokens on a 401
    // AND flip sessionExpired when refresh fails — without an import cycle
    // (client never imports the store; the store owns the callback).
    setRefreshHandler(async () => {
      const rt = get().refreshToken;
      if (!rt) return null;
      try {
        const tokens = await refreshTokenApi(rt);
        get().setTokens(tokens.access_token, tokens.refresh_token);
        return tokens.access_token;
      } catch {
        get().markSessionExpired();
        return null;
      }
    });
  },

  setTokens: (access, refresh) => {
    setAccessToken(access);
    const persisted = loadPersisted();
    const updated: PersistedAuth = {
      accessToken: access,
      refreshToken: refresh,
      role: persisted?.role ?? get().role ?? "professor",
      email: persisted?.email ?? get().email ?? "",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    set({
      accessToken: access,
      refreshToken: refresh,
      sessionExpired: false,
    });
  },

  markSessionExpired: () => {
    setAccessToken(null);
    localStorage.removeItem(STORAGE_KEY);
    set({
      accessToken: null,
      refreshToken: null,
      role: null,
      email: null,
      sessionExpired: true,
      status: "idle",
      error: null,
    });
  },

  login: async (email, password) => {
    set({ status: "loading", error: null, sessionExpired: false });
    try {
      const tokens = await apiLogin({ email, password });
      // Web dashboard is professor-only. The backend also enforces this via the
      // X-Client-Type header, but guard here too so a non-professor token never
      // gets persisted even if the header check were bypassed.
      if (tokens.role !== "professor") {
        setAccessToken(null);
        set({
          status: "error",
          error: "교수 계정만 웹 대시보드에 로그인할 수 있습니다.",
          sessionExpired: false,
        });
        return false;
      }
      setAccessToken(tokens.access_token);
      const persisted: PersistedAuth = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        role: tokens.role,
        email,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        role: tokens.role,
        email,
        status: "idle",
        sessionExpired: false,
      });
      return true;
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  logout: () => {
    setAccessToken(null);
    localStorage.removeItem(STORAGE_KEY);
    set({
      accessToken: null,
      refreshToken: null,
      role: null,
      email: null,
      status: "idle",
      error: null,
      sessionExpired: false,
    });
  },
}));
