// Tests for the student browser attendance store. Covers the QR payload
// parsing (sessionId|qrToken||course|label|week|phase) and the dual-trigger
// submit gate (must have BOTH qr + audio nonce before calling /attendance/verify).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStudentAttendanceStore } from "@/store/studentAttendance";
import * as apiClient from "@/api/client";
import type { VerifyResult } from "@/api/types";

// Stub localStorage (the store + deviceIdentity use it). Each test gets a
// fresh store + fresh UUID, so isolate the storage per test.
const store: Record<string, string> = {};
const localStorageStub = {
  length: 0,
  clear: () => {
    for (const k of Object.keys(store)) delete store[k];
  },
  getItem: (k: string) => store[k] ?? null,
  key: (i: number) => Object.keys(store)[i] ?? null,
  removeItem: (k: string) => {
    delete store[k];
  },
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
} as unknown as Storage;

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageStub,
  configurable: true,
});

// crypto.randomUUID stub for deviceIdentity's UUID generation.
Object.defineProperty(globalThis, "crypto", {
  value: {
    ...globalThis.crypto,
    randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = 1;
      return arr;
    },
  },
  configurable: true,
});

describe("studentAttendance store", () => {
  beforeEach(() => {
    localStorageStub.clear();
    useStudentAttendanceStore.getState().reset();
    useStudentAttendanceStore.setState({
      checkInDone: false,
      checkOutDone: false,
      deviceRegistered: true, // skip device registration in these tests
    });
  });

  it("parses a check-in QR payload with context block", () => {
    const raw = "sess-123|qr-abc||자료구조|월 1교시|3|1";
    useStudentAttendanceStore.getState().startCapture();
    useStudentAttendanceStore.getState().setQr(raw);

    const s = useStudentAttendanceStore.getState();
    expect(s.sessionId).toBe("sess-123");
    expect(s.qrToken).toBe("qr-abc");
    expect(s.courseName).toBe("자료구조");
    expect(s.scheduleLabel).toBe("월 1교시");
    expect(s.weekNumber).toBe(3);
    expect(s.isCheckoutPhase).toBe(false);
  });

  it("parses a check-out QR (phase field == 2)", () => {
    const raw = "s1|tok||OS|화 2~3교시|5|2";
    useStudentAttendanceStore.getState().startCapture();
    useStudentAttendanceStore.getState().setQr(raw);

    const s = useStudentAttendanceStore.getState();
    expect(s.isCheckoutPhase).toBe(true);
    expect(s.weekNumber).toBe(5);
  });

  it("parses a minimal QR (sessionId|qrToken, no context block)", () => {
    const raw = "s1|tok-only";
    useStudentAttendanceStore.getState().startCapture();
    useStudentAttendanceStore.getState().setQr(raw);

    const s = useStudentAttendanceStore.getState();
    expect(s.sessionId).toBe("s1");
    expect(s.qrToken).toBe("tok-only");
    expect(s.courseName).toBeNull();
    expect(s.weekNumber).toBeNull();
  });

  it("does NOT submit until BOTH qr and audio nonce are present", () => {
    const verifySpy = vi
      .spyOn(apiClient, "verifyAttendance")
      .mockResolvedValue({} as VerifyResult);

    useStudentAttendanceStore.getState().startCapture();
    useStudentAttendanceStore.getState().setQr("s1|qr");
    // QR alone should not trigger a verify call.
    expect(verifySpy).not.toHaveBeenCalled();
    expect(useStudentAttendanceStore.getState().phase).toBe("capturing");

    // Now provide the audio nonce — submit fires.
    useStudentAttendanceStore.getState().setAudioNonce("deadbeef");
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith({
      session_id: "s1",
      qr_token: "qr",
      audio_nonce: "deadbeef",
      device_uuid: expect.any(String),
    });
    verifySpy.mockRestore();
  });

  it("marks 1차 done on a verified check_in result", async () => {
    const result: VerifyResult = {
      status: "verified",
      cross_verified: true,
      device_matched: true,
      reason: null,
      check_phase: "check_in",
      check_in_done: true,
      check_out_done: false,
    };
    const verifySpy = vi
      .spyOn(apiClient, "verifyAttendance")
      .mockResolvedValue(result);

    useStudentAttendanceStore.getState().startCapture();
    useStudentAttendanceStore.getState().setQr("s1|qr");
    useStudentAttendanceStore.getState().setAudioNonce("deadbeef");

    // wait for the async submit to settle
    await vi.waitFor(() => {
      expect(useStudentAttendanceStore.getState().phase).toBe("done");
    });

    const s = useStudentAttendanceStore.getState();
    expect(s.checkInDone).toBe(true);
    expect(s.checkOutDone).toBe(false);
    expect(s.result?.status).toBe("verified");
    verifySpy.mockRestore();
  });

  it("automatically retries once after cross-verification rejection", async () => {
    const rejected: VerifyResult = {
      status: "rejected",
      cross_verified: false,
      device_matched: true,
      reason: "cross_verify_failed",
      check_phase: null,
    };
    const verified: VerifyResult = {
      status: "verified",
      cross_verified: true,
      device_matched: true,
      reason: null,
      check_phase: "check_in",
      check_in_done: true,
      check_out_done: false,
    };
    const verifySpy = vi
      .spyOn(apiClient, "verifyAttendance")
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(verified);

    useStudentAttendanceStore.getState().startCapture();
    useStudentAttendanceStore.getState().setQr("s1|qr");
    useStudentAttendanceStore.getState().setAudioNonce("stale");

    await vi.waitFor(() => {
      expect(useStudentAttendanceStore.getState().phase).toBe("capturing");
      expect(verifySpy).toHaveBeenCalledTimes(1);
    });

    useStudentAttendanceStore.getState().setAudioNonce("fresh");
    await vi.waitFor(() => {
      expect(useStudentAttendanceStore.getState().phase).toBe("done");
    });
    expect(verifySpy).toHaveBeenCalledTimes(2);
    expect(useStudentAttendanceStore.getState().result?.status).toBe("verified");
    verifySpy.mockRestore();
  });

  it("ignores setQr/setAudioNonce outside the capturing phase", () => {
    const verifySpy = vi
      .spyOn(apiClient, "verifyAttendance")
      .mockResolvedValue({} as VerifyResult);

    // idle phase — inputs are ignored
    useStudentAttendanceStore.getState().setQr("s1|qr");
    useStudentAttendanceStore.getState().setAudioNonce("deadbeef");
    expect(verifySpy).not.toHaveBeenCalled();
    expect(useStudentAttendanceStore.getState().qrToken).toBeNull();

    verifySpy.mockRestore();
  });
});
