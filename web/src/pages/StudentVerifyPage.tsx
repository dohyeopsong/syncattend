import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useStudentAttendanceStore } from "@/store/studentAttendance";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MicCaptureService } from "@/lib/micCapture";
import { getOrCreateDeviceUuid } from "@/lib/deviceIdentity";
import jsQR from "jsqr";
import {
  QrCode,
  Mic,
  CheckCircle2,
  Loader2,
  RefreshCw,
  LogOut,
  Radio,
  AlertTriangle,
  Home,
  TimerOff,
  Link2Off,
  Repeat,
  Smartphone,
  Copy,
  Clock,
  ShieldCheck,
  Ear,
  ShieldAlert,
  Info,
} from "lucide-react";
import type { VerifyReason } from "@/api/types";

// Per-reason messaging for the 5 server rejection reasons. Mirrors the Flutter
// attendance_verify_screen.dart helpers (verifyReasonMessage / Icon / guidance).
const REASON_META: Record<
  Exclude<VerifyReason, "not_enrolled">,
  { label: string; Icon: typeof Info; guidance: string }
> = {
  window_closed: {
    label: "인증 창 종료",
    Icon: TimerOff,
    guidance: "교수님께 인증 창을 다시 열어달라고 요청한 뒤 재인증하세요.",
  },
  cross_verify_failed: {
    label: "QR×음향 교차검증 실패",
    Icon: Link2Off,
    guidance:
      "QR과 음향이 같은 강의실 것인지 확인하고, 스피커 근처에서 다시 시도하세요.",
  },
  nonce_reused: {
    label: "토큰 재사용 감지",
    Icon: Repeat,
    guidance: "최신 QR을 다시 스캔하세요. 이전 화면 캡처는 사용할 수 없습니다.",
  },
  device_mismatch: {
    label: "기기 UUID 불일치",
    Icon: Smartphone,
    guidance: "기기 변경 재인증(@wku.ac.kr)이 필요할 수 있습니다.",
  },
  duplicate_attendance: {
    label: "중복 출석",
    Icon: Copy,
    guidance: "이미 출석 처리된 세션입니다. 출결 이력에서 확인하세요.",
  },
};

// Student attendance verification page (browser).
//
// Mirrors the Flutter attendance_verify_screen: simultaneous QR scan (camera)
// + ultrasonic mic capture → /attendance/verify. Designed for iPhone Safari:
// both the camera and mic are opened inside the "인증 시작" click gesture
// (Safari only grants media access inside a user gesture).
export function StudentVerifyPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const email = useAuthStore((s) => s.email);

  const s = useStudentAttendanceStore();
  const {
    phase,
    secondsRemaining,
    result,
    error,
    checkInDone,
    checkOutDone,
    courseName,
    scheduleLabel,
    weekNumber,
    isCheckoutPhase,
    qrToken,
    audioNonce,
    deviceError,
  } = s;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const micRef = useRef<MicCaptureService | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0); // diagnostic 0..1

  // ---- QR scanning loop ----------------------------------------------------
  function scanFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const code = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
    if (code && code.data) {
      useStudentAttendanceStore.getState().setQr(code.data);
    }
    if (useStudentAttendanceStore.getState().phase === "capturing") {
      rafRef.current = requestAnimationFrame(scanFrame);
    }
  }

  // ---- Countdown tick ------------------------------------------------------
  useEffect(() => {
    if (phase !== "capturing") return;
    const id = setInterval(() => {
      useStudentAttendanceStore.getState().tickSecond();
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ---- Start capture (user gesture) ---------------------------------------
  async function startCapture() {
    setCameraError(null);
    setMicError(null);
    useStudentAttendanceStore.getState().startCapture();
    getOrCreateDeviceUuid();

    // 1) Camera (rear-facing on mobile).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      rafRef.current = requestAnimationFrame(scanFrame);
    } catch (e) {
      setCameraError(
        e instanceof Error ? e.message : "카메라를 열 수 없습니다. 권한을 확인하세요.",
      );
    }

    // 2) Microphone + ultrasonic decode.
    try {
      const mic = new MicCaptureService();
      micRef.current = mic;
      mic.onSlot = (slot) => {
        setAudioLevel(slot !== null ? 1 : 0);
      };
      await mic.start((nonce) => {
        useStudentAttendanceStore.getState().setAudioNonce(nonce);
      });
    } catch (e) {
      setMicError(
        e instanceof Error ? e.message : "마이크를 열 수 없습니다. 권한을 확인하세요.",
      );
    }
  }

  // ---- Cleanup -------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      void micRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (phase === "capturing") return;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    void micRef.current?.stop();
    micRef.current = null;
  }, [phase]);

  function onLogout() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    void micRef.current?.stop();
    logout();
    navigate("/student/login", { replace: true });
  }

  function goHome() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    void micRef.current?.stop();
    useStudentAttendanceStore.getState().reset();
    navigate("/student", { replace: true });
  }

  const isVerified = result?.status === "verified";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-6">
      <Card className="w-full max-w-md shadow-soft-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Radio className="h-5 w-5 text-primary" /> 학생 출결 인증
            </CardTitle>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={goHome}>
                <Home className="h-4 w-4" /> 홈
              </Button>
              <Button variant="ghost" size="sm" onClick={onLogout}>
                <LogOut className="h-4 w-4" /> 로그아웃
              </Button>
            </div>
          </div>
          <CardDescription className="truncate">
            {email ?? "학생"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Session context banner */}
          {(courseName || scheduleLabel || weekNumber) && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <div className="font-medium text-foreground">
                {courseName ?? "강의"}
                {scheduleLabel && (
                  <span className="text-muted-foreground"> · {scheduleLabel}</span>
                )}
                {weekNumber && (
                  <span className="text-muted-foreground"> · {weekNumber}주차</span>
                )}
              </div>
              <Badge
                variant={isCheckoutPhase ? "default" : "secondary"}
                className="mt-1.5 gap-1"
              >
                {isCheckoutPhase ? "종료 인증 (2/2)" : "시작 인증 (1/2)"}
              </Badge>
            </div>
          )}

          {/* 1차 / 2차 completion indicators */}
          <div className="grid grid-cols-2 gap-2">
            <PhaseIndicator label="1차 (시작)" done={checkInDone} />
            <PhaseIndicator label="2차 (종료)" done={checkOutDone} />
          </div>

          {/* ── 3계층 방어 시각화 (capturing 중에만) ── */}
          {phase === "capturing" && (
            <DefenseSteps
              qrDone={!!qrToken}
              audioDone={!!audioNonce}
              serverActive={false}
              serverDone={false}
              audioPulse={audioLevel > 0}
            />
          )}

          {phase === "idle" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                교수님이 인증을 열면 아래 버튼을 눌러 QR과 초음파를 동시에
                인증하세요. 카메라와 마이크 권한이 필요합니다.
              </p>
              <Button className="w-full" onClick={() => void startCapture()}>
                <QrCode className="h-4 w-4" /> 인증 시작
              </Button>
              {deviceError && (
                <p className="text-xs text-destructive">기기 오류: {deviceError}</p>
              )}
            </div>
          )}

          {phase === "capturing" && (
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-xl border bg-black">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-56 w-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-32 w-32 rounded-lg border-2 border-white/70" />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="flex items-center gap-2 text-sm">
                  <QrCode className="h-4 w-4 text-muted-foreground" /> QR 대기 중
                </span>
                <Badge variant="secondary">{secondsRemaining}s</Badge>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="flex items-center gap-2 text-sm">
                  <Mic
                    className={`h-4 w-4 ${audioLevel > 0 ? "text-success" : "text-muted-foreground"}`}
                  />
                  초음파 수신
                </span>
                <span className="text-xs text-muted-foreground">
                  {audioLevel > 0 ? "신호 감지됨" : "대기 중"}
                </span>
              </div>

              {cameraError && (
                <p className="text-xs text-destructive">카메라: {cameraError}</p>
              )}
              {micError && (
                <p className="text-xs text-destructive">마이크: {micError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                QR이 보이도록 카메라를 향하세요. 초음파는 마이크가 자동 수신합니다.
              </p>
            </div>
          )}

          {phase === "submitting" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">서버 검증 중…</p>
            </div>
          )}

          {/* ── 결과 패널 (앱 수준으로 보강) ── */}
          {phase === "done" && result && (
            <div className="space-y-4">
              <ResultDetail
                status={result.status}
                reason={result.reason}
                checkPhase={result.check_phase}
                riskWarning={result.risk_warning?.message ?? null}
                checkInDone={checkInDone}
                checkOutDone={checkOutDone}
              />

              <p className="text-center text-xs text-muted-foreground">
                실패는 결석이 아닙니다 — 교수님이 창을 연장하거나 확인할 수 있습니다.
              </p>

              {isVerified ? (
                <Button className="w-full" onClick={goHome}>
                  확인
                </Button>
              ) : (
                <Button
                  variant="default"
                  className="w-full bg-amber-500 hover:bg-amber-600"
                  onClick={() => useStudentAttendanceStore.getState().restart()}
                >
                  <RefreshCw className="h-4 w-4" /> 다시 시도
                </Button>
              )}
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error ?? "오류가 발생했습니다."}</span>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                실패는 결석이 아닙니다 — 다시 시도하거나 교수님께 확인을 요청하세요.
              </p>
              <Button
                variant="default"
                className="w-full bg-amber-500 hover:bg-amber-600"
                onClick={() => useStudentAttendanceStore.getState().restart()}
              >
                <RefreshCw className="h-4 w-4" /> 다시 시도
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── 3계층 방어 시각화: QR 인식 → 음향 수신 → 서버 검증 ──
// Mirrors the Flutter _DefenseSteps widget. Each step is a numbered node
// (done → green check, active → indigo/pulsing, idle → gray).
function DefenseSteps({
  qrDone,
  audioDone,
  serverActive,
  serverDone,
  audioPulse,
}: {
  qrDone: boolean;
  audioDone: boolean;
  serverActive: boolean;
  serverDone: boolean;
  audioPulse: boolean;
}) {
  const steps = [
    {
      index: 1,
      label: "QR 인식",
      Icon: QrCode,
      done: qrDone,
      active: !qrDone,
      pulse: false,
    },
    {
      index: 2,
      label: "음향 수신",
      Icon: Ear,
      done: audioDone,
      active: qrDone && !audioDone,
      pulse: audioPulse && !audioDone,
    },
    {
      index: 3,
      label: "서버 검증",
      Icon: ShieldCheck,
      done: serverDone,
      active: serverActive,
      pulse: false,
    },
  ];
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3.5">
      <div className="mb-3 flex items-center gap-1.5">
        <ShieldAlert className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold">3계층 방어</span>
      </div>
      <div className="flex items-start">
        {steps.map((step, i) => {
          const color = step.done
            ? "text-emerald-600 dark:text-emerald-400"
            : step.active
              ? "text-primary"
              : "text-muted-foreground";
          const bg = step.done
            ? "bg-emerald-500/10 border-emerald-500/40"
            : step.active
              ? "bg-primary/10 border-primary/40"
              : "bg-muted border-border";
          return (
            <div key={step.index} className="flex flex-1 items-start">
              <div className="flex w-16 flex-col items-center gap-1.5">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 ${bg} ${step.pulse ? "animate-pulse" : ""}`}
                >
                  {step.done ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <step.Icon className={`h-4 w-4 ${color}`} />
                  )}
                </div>
                <span
                  className={`text-xs ${step.done || step.active ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`mt-4 h-0.5 flex-1 rounded-full ${step.done ? "bg-emerald-500" : "bg-border"}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 결과 상세 패널 ──
// Mirrors the Flutter _ResultDetail: status headline + per-reason icon +
// actionable guidance in an amber card. present=green, pending/rejected=amber.
function ResultDetail({
  status,
  reason,
  checkPhase,
  riskWarning,
  checkInDone,
  checkOutDone,
}: {
  status: "verified" | "pending" | "rejected" | "unknown";
  reason: VerifyReason | null;
  checkPhase: "check_in" | "check_out" | null;
  riskWarning: string | null;
  checkInDone: boolean;
  checkOutDone: boolean;
}) {
  const present = status === "verified";
  const pending = status === "pending";
  const rejected = status === "rejected";
  const color = present ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";

  const headline =
    status === "verified"
      ? checkPhase === "check_out"
        ? "2차 인증 성공"
        : checkPhase === "check_in"
          ? "1차 인증 성공"
          : "인증 성공"
      : status === "pending"
        ? "대기 중 (교수 확인 필요)"
        : status === "rejected"
          ? `거부됨: ${reason && reason in REASON_META ? REASON_META[reason as Exclude<VerifyReason, "not_enrolled">].label : ""}`
          : "알 수 없는 상태";

  const StatusIcon = present ? CheckCircle2 : pending ? Clock : AlertTriangle;
  const reasonMeta =
    rejected && reason && reason !== "not_enrolled" && reason in REASON_META
      ? REASON_META[reason as Exclude<VerifyReason, "not_enrolled">]
      : null;

  return (
    <div className="space-y-3">
      {/* Headline */}
      <div className="flex items-center justify-center gap-2">
        <StatusIcon className={`h-5 w-5 ${color}`} />
        <span className={`text-base font-semibold ${color}`}>{headline}</span>
      </div>

      {/* Verified sub-message */}
      {present && (
        <p className="text-center text-sm text-muted-foreground">
          {checkInDone && checkOutDone
            ? "이중 인증이 완료되었습니다."
            : checkInDone
              ? "시작 인증이 완료되었습니다. 수업 종료 후 2차 인증을 진행하세요."
              : checkOutDone
                ? "종료 인증이 완료되었습니다."
                : "인증이 완료되었습니다."}
        </p>
      )}

      {/* Rejected: per-reason guidance card */}
      {reasonMeta && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <reasonMeta.Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs leading-relaxed text-foreground">
            {reasonMeta.guidance}
          </p>
        </div>
      )}

      {/* device_mismatch extra hint (even when not the primary reason) */}
      {reason === "device_mismatch" && !reasonMeta && (
        <p className="text-xs text-muted-foreground">
          기기 변경 재인증(@wku.ac.kr)이 필요할 수 있습니다.
        </p>
      )}

      {/* Risk warning */}
      {riskWarning && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          위험 경고: {riskWarning}
        </p>
      )}
    </div>
  );
}

function PhaseIndicator({ label, done }: { label: string; done: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm ${
        done
          ? "border-success/40 bg-success/5 text-success"
          : "border-border/60 bg-muted/20 text-muted-foreground"
      }`}
    >
      {done ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <div className="h-4 w-4 rounded-full border-2 border-current opacity-40" />
      )}
      {label}
    </div>
  );
}
