import { create } from "zustand";
import { login as apiLogin, setAccessToken } from "@/api/client";
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
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  role: null,
  email: null,
  status: "idle",
  error: null,

  hydrate: () => {
    const persisted = loadPersisted();
    if (persisted) {
      setAccessToken(persisted.accessToken);
      set({
        accessToken: persisted.accessToken,
        refreshToken: persisted.refreshToken,
        role: persisted.role,
        email: persisted.email,
      });
    }
  },

  login: async (email, password) => {
    set({ status: "loading", error: null });
    try {
      const tokens = await apiLogin({ email, password });
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
    });
  },
}));
