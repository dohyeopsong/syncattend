import { create } from "zustand";

type HealthState = {
  status: "idle" | "loading" | "ok" | "error";
  detail: string;
  checkHealth: () => Promise<void>;
};

// Calls backend /health via the Vite proxy (/api -> :8000).
export const useHealthStore = create<HealthState>((set) => ({
  status: "idle",
  detail: "",
  checkHealth: async () => {
    set({ status: "loading", detail: "" });
    try {
      const res = await fetch("/api/health");
      const body = await res.json();
      set({ status: "ok", detail: `${body.service} v${body.version}` });
    } catch (e) {
      set({ status: "error", detail: String(e) });
    }
  },
}));
