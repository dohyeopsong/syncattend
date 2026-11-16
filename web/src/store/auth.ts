import { create } from "zustand";
import {
  login as apiLogin,
  loginStudent as apiLoginStudent,
  refreshTokenApi,
  setAccessToken,
  setRefreshHandler,
} from "@/api/client";
import type { Role } from "@/api/types";

const STORAGE_KEY = "syncattend.auth";

type SetFn = (
  partial:
    | Partial<AuthState>
    | ((state: AuthState) => Partial<AuthState>),
) => void;

/** Shared login path for professor (web) and student (student-web) clients.
 *  The backend gates by X-Client-Type; we double-check the returned role so a
 *  mismatched token is never persisted. */
async function _doLogin(
  set: SetFn,
  email: string,
  password: string,
  expectedRole: Role,
  clientType: "web" | "student-web",
): Promise<boolean> {
  set({ status: "loading", error: null, sessionExpired: false });
  try {
    const tokens =
      clientType === "student-web"
        ? await apiLoginStudent({ email, password })
        : await apiLogin({ email, password });
    if (tokens.role !== expectedRole) {
      setAccessToken(null);
      set({
        status: "error",
        error:
          expectedRole === "professor"
            ? "교수 계정만 웹 대시보드에 로그인할 수 있습니다."
            : "학생 계정만 학생 웹에 로그인할 수 있습니다.",
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
}

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
  /** Professor dashboard login (X-Client-Type: web). Professor-only. */
  login: (email: string, password: string) => Promise<boolean>;
  /** Student browser login (X-Client-Type: student-web). Student-only — lets a
   *  student authenticate from a browser (e.g. iPhone Safari) without the app. */
  loginStudent: (email: string, password: string) => Promise<boolean>;
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
      // Restore either a professor (dashboard) or student (browser auth)
      // session. Other roles are refused and cleared.
      if (persisted.role !== "professor" && persisted.role !== "student") {
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

  login: async (email, password) =>
    _doLogin(set, email, password, "professor", "web"),

  loginStudent: async (email, password) =>
    _doLogin(set, email, password, "student", "student-web"),

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
