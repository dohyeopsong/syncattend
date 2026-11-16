// Student device bootstrap store (browser side).
//
// Mirrors the Flutter AuthController bootstrap (mobile/lib/features/auth/
// auth_controller.dart): on entering the student area, check whether this
// device's UUID is already bound to the account via GET /devices/me:
//   200 + uuid matches local UUID → ready
//   404 (no binding)              → needsDeviceRegistration
//   uuid bound to a different acct → needsReauth
//   401                           → loggedOut (token invalid)
//   network error                 → optimistic ready (UUID exists)

import { create } from "zustand";
import {
  confirmReauth as apiConfirmReauth,
  getMyDevice as apiGetMyDevice,
  registerDevice as apiRegisterDevice,
  requestReauthCode as apiRequestReauthCode,
  ApiRequestError,
} from "@/api/client";
import { getOrCreateDeviceUuid } from "@/lib/deviceIdentity";

export type DevicePhase =
  | "loading"
  | "needsDeviceRegistration"
  | "needsReauth"
  | "ready";

interface StudentDeviceState {
  phase: DevicePhase;
  error: string | null;
  busy: boolean;
  codeSent: boolean;

  bootstrap: () => Promise<void>;
  registerDevice: () => Promise<boolean>;
  requestReauthCode: (email: string) => Promise<boolean>;
  confirmReauth: (email: string, code: string) => Promise<boolean>;
  reset: () => void;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export const useStudentDeviceStore = create<StudentDeviceState>((set) => ({
  phase: "loading",
  error: null,
  busy: false,
  codeSent: false,

  bootstrap: async () => {
    set({ phase: "loading", error: null });
    const localUuid = getOrCreateDeviceUuid();
    try {
      const binding = await apiGetMyDevice();
      if (binding.device_uuid === localUuid) {
        set({ phase: "ready" });
      } else {
        // UUID is bound to a DIFFERENT account → email re-auth required.
        set({ phase: "needsReauth" });
      }
    } catch (e) {
      if (e instanceof ApiRequestError) {
        if (e.status === 404) {
          set({ phase: "needsDeviceRegistration" });
          return;
        }
        if (e.status === 401) {
          // Token invalid — the auth store will handle re-login routing.
          set({ phase: "needsDeviceRegistration", error: e.message });
          return;
        }
      }
      // Network error: optimistically ready if a local UUID exists (offline
      // resilience — the verify flow will surface a real error if the device
      // truly isn't bound).
      if (localUuid) set({ phase: "ready" });
      else set({ phase: "needsDeviceRegistration" });
    }
  },

  registerDevice: async () => {
    set({ busy: true, error: null });
    try {
      const uuid = getOrCreateDeviceUuid();
      await apiRegisterDevice(uuid);
      set({ phase: "ready", busy: false });
      return true;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        // UUID bound to a different account → must reauth.
        set({ phase: "needsReauth", busy: false });
        return false;
      }
      set({ busy: false, error: errMsg(e) });
      return false;
    }
  },

  requestReauthCode: async (email) => {
    set({ busy: true, error: null });
    try {
      await apiRequestReauthCode(email.trim());
      set({ busy: false, codeSent: true });
      return true;
    } catch (e) {
      set({ busy: false, error: errMsg(e) });
      return false;
    }
  },

  confirmReauth: async (email, code) => {
    set({ busy: true, error: null });
    try {
      const uuid = getOrCreateDeviceUuid();
      await apiConfirmReauth(email.trim(), code.trim(), uuid);
      set({ phase: "ready", busy: false, codeSent: false });
      return true;
    } catch (e) {
      set({ busy: false, error: errMsg(e) });
      return false;
    }
  },

  reset: () => set({ phase: "loading", error: null, busy: false, codeSent: false }),
}));
