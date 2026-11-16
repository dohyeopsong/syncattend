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
  XCircle,
  Loader2,
  RefreshCw,
  LogOut,
  Radio,
  AlertTriangle,
  Home,
} from "lucide-react";

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
  // Draw the camera frame to a hidden canvas, read the pixels, and run jsQR.
  // jsQR is pure JS so it works on every browser (Safari has no BarcodeDetector).
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
    const code = jsQR(imageData.data, w, h, {
      inversionAttempts: "dontInvert",
    });
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
  // MUST be called from a click — Safari only grants camera + mic inside a
  // gesture handler. Opens both media streams, starts the QR scan loop, and
  // starts the ultrasonic decoder.
  async function startCapture() {
    setCameraError(null);
    setMicError(null);
    useStudentAttendanceStore.getState().startCapture();

    // Ensure a device UUID exists (generates + persists on first call).
    getOrCreateDeviceUuid();

    // 1) Camera (rear-facing on mobile — facingMode: environment).
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
        // crude diagnostic: any non-null slot = ultrasonic energy detected.
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

  // Stop media when leaving the capturing phase (submit / done / error).
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
          {/* Session context banner (display-only, parsed from QR) */}
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
              {/* Hidden video + canvas for QR scanning. The video is mirrored
                  into a small preview so the student can aim at the QR. */}
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
              <p className="text-sm text-muted-foreground">인증 확인 중…</p>
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-4">
              {isVerified ? (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>
                  <p className="text-lg font-semibold">
                    {result?.check_phase === "check_out"
                      ? "2차 인증 성공"
                      : "1차 인증 성공"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {checkInDone && checkOutDone
                      ? "이중 인증이 완료되었습니다."
                      : checkInDone
                        ? "시작 인증이 완료되었습니다. 수업 종료 후 2차 인증을 진행하세요."
                        : "종료 인증이 완료되었습니다."}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                    <XCircle className="h-8 w-8" />
                  </div>
                  <p className="text-lg font-semibold">인증 실패</p>
                  <p className="text-sm text-muted-foreground">
                    {result?.reason ?? "인증에 실패했습니다."}
                  </p>
                </div>
              )}
              <Button
                className="w-full"
                onClick={() => {
                  useStudentAttendanceStore.getState().restart();
                }}
              >
                <RefreshCw className="h-4 w-4" /> 다시 인증
              </Button>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error ?? "오류가 발생했습니다."}</span>
              </div>
              <Button
                className="w-full"
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
