// Student attendance verification store (browser side).
//
// Mirrors the Flutter AttendanceController (mobile/lib/features/attendance/
// attendance_controller.dart): captures QR + ultrasonic audio nonce
// simultaneously, submits both to /attendance/verify, and tracks 1차/2차
// completion from the server's VerifyResult.check_in_done / check_out_done.

import { create } from "zustand";
import {
  registerDevice as apiRegisterDevice,
  verifyAttendance as apiVerify,
} from "@/api/client";
import type { VerifyResult } from "@/api/types";
import { getOrCreateDeviceUuid } from "@/lib/deviceIdentity";

export type VerifyPhase = "idle" | "capturing" | "submitting" | "done" | "error";

export interface StudentAttendanceState {
  phase: VerifyPhase;
  qrToken: string | null;
  audioNonce: string | null;
  sessionId: string | null;
  // Display-only context parsed from the QR's "||" block.
  courseName: string | null;
  scheduleLabel: string | null;
  weekNumber: number | null;
  isCheckoutPhase: boolean;
  secondsRemaining: number;
  result: VerifyResult | null;
  error: string | null;
  checkInDone: boolean;
  checkOutDone: boolean;
  // Device registration state.
  deviceRegistered: boolean;
  deviceError: string | null;
  captureAttempt: number;
  crossVerifyRetries: number;

  setQr: (raw: string) => void;
  setAudioNonce: (nonce: string) => void;
  startCapture: () => void;
  tickSecond: () => void;
  submit: () => Promise<void>;
  restart: () => void;
  reset: () => void;
  registerDevice: () => Promise<boolean>;
}

const DEFAULT_WINDOW_SECONDS = 60;

export const useStudentAttendanceStore = create<StudentAttendanceState>(
  (set, get) => ({
    phase: "idle",
    qrToken: null,
    audioNonce: null,
    sessionId: null,
    courseName: null,
    scheduleLabel: null,
    weekNumber: null,
    isCheckoutPhase: false,
    secondsRemaining: DEFAULT_WINDOW_SECONDS,
    result: null,
    error: null,
    checkInDone: false,
    checkOutDone: false,
    deviceRegistered: false,
    deviceError: null,
    captureAttempt: 0,
    crossVerifyRetries: 0,

    setQr: (raw) => {
      if (get().phase !== "capturing") return;
      // Payload: "sessionId|qrToken" with optional "||course|label|week|phase".
      const ctxSplit = raw.split("||");
      const authPart = ctxSplit[0] ?? "";
      const ctxPart = ctxSplit.length > 1 ? ctxSplit[1] : "";

      let sessionId = get().sessionId;
      let qr = authPart;
      if (authPart.includes("|")) {
        const parts = authPart.split("|");
        sessionId = parts[0] ?? "";
        qr = parts.length > 1 ? parts[1] ?? "" : "";
      }

      let courseName: string | null = null;
      let scheduleLabel: string | null = null;
      let weekNumber: number | null = null;
      let isCheckout = false;
      if (ctxPart) {
        const f = ctxPart.split("|");
        courseName = f[0] || null;
        scheduleLabel = f[1] || null;
        const wk = f[2] ? parseInt(f[2], 10) : null;
        weekNumber = wk && wk > 0 ? wk : null;
        isCheckout = f[3] === "2";
      }

      set({
        qrToken: qr,
        sessionId,
        courseName,
        scheduleLabel,
        weekNumber,
        isCheckoutPhase: isCheckout,
      });
      void get().submit();
    },

    setAudioNonce: (nonce) => {
      if (get().phase !== "capturing") return;
      set({ audioNonce: nonce });
      void get().submit();
    },

    startCapture: () => {
      set({
        phase: "capturing",
        qrToken: null,
        audioNonce: null,
        sessionId: null,
        courseName: null,
        scheduleLabel: null,
        weekNumber: null,
        isCheckoutPhase: false,
        secondsRemaining: DEFAULT_WINDOW_SECONDS,
        result: null,
        error: null,
        captureAttempt: get().captureAttempt + 1,
        crossVerifyRetries: 0,
      });
    },

    tickSecond: () => {
      const next = get().secondsRemaining - 1;
      set({ secondsRemaining: next > 0 ? next : 0 });
    },

    submit: async () => {
      const s = get();
      const hasSession = s.sessionId && s.sessionId.length > 0;
      const hasQr = s.qrToken && s.qrToken.length > 0;
      const hasAudio = s.audioNonce && s.audioNonce.length > 0;
      if (!hasSession || !hasQr || !hasAudio || s.phase !== "capturing") return;

      set({ phase: "submitting", error: null });
      try {
        // Ensure the device UUID is registered before verify (the backend
        // rejects a verify with an unbound device at step 4).
        if (!s.deviceRegistered) {
          const ok = await get().registerDevice();
          if (!ok) {
            set({ phase: "error" });
            return;
          }
        }
        const deviceUuid = getOrCreateDeviceUuid();
        const result = await apiVerify({
          session_id: s.sessionId!,
          qr_token: s.qrToken!,
          audio_nonce: s.audioNonce!,
          device_uuid: deviceUuid,
        });

        if (
          result.status === "rejected" &&
          result.reason === "cross_verify_failed" &&
          get().crossVerifyRetries < 1
        ) {
          set({
            phase: "capturing",
            audioNonce: null,
            result: null,
            error: null,
            captureAttempt: get().captureAttempt + 1,
            crossVerifyRetries: get().crossVerifyRetries + 1,
          });
          return;
        }

        const newCheckIn =
          result.status === "verified"
            ? result.check_in_done ?? false
            : s.checkInDone;
        const newCheckOut =
          result.status === "verified"
            ? result.check_out_done ?? false
            : s.checkOutDone;

        set({
          phase: "done",
          result,
          checkInDone: s.checkInDone || newCheckIn,
          checkOutDone: s.checkOutDone || newCheckOut,
        });
      } catch (e) {
        set({
          phase: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    restart: () => {
      set({
        phase: "capturing",
        qrToken: null,
        audioNonce: null,
        sessionId: null,
        courseName: null,
        scheduleLabel: null,
        weekNumber: null,
        isCheckoutPhase: false,
        secondsRemaining: DEFAULT_WINDOW_SECONDS,
        result: null,
        error: null,
        captureAttempt: get().captureAttempt + 1,
        crossVerifyRetries: 0,
      });
    },

    reset: () => {
      set({
        phase: "idle",
        qrToken: null,
        audioNonce: null,
        sessionId: null,
        courseName: null,
        scheduleLabel: null,
        weekNumber: null,
        isCheckoutPhase: false,
        secondsRemaining: DEFAULT_WINDOW_SECONDS,
        result: null,
        error: null,
      });
    },

    registerDevice: async () => {
      try {
        const uuid = getOrCreateDeviceUuid();
        await apiRegisterDevice(uuid);
        set({ deviceRegistered: true, deviceError: null });
        return true;
      } catch (e) {
        // 409 with the same UUID already bound to this account is OK — the
        // device is already registered. Other errors (UUID bound to a DIFFERENT
        // account) are real failures.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("일치") || msg.includes("already") || msg.includes("409")) {
          set({ deviceRegistered: true, deviceError: null });
          return true;
        }
        set({ deviceError: msg });
        return false;
      }
    },
  }),
);
