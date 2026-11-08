import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useSessionStore } from "@/store/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RealtimeRiskPanel } from "@/components/RealtimeRiskPanel";
import { CountdownRing } from "@/components/ui/countdown-ring";
import {
  UltrasonicEmitter,
  DEFAULT_PROTOCOL,
  isAudioUnlocked,
} from "@/lib/ultrasonicEmitter";
import { Radio, Timer, Volume2, X, LogIn, LogOut } from "lucide-react";

// Session popup: two-phase attendance. The professor opens a session
// (phase=check_in → "시작 인증"), students verify, then the professor clicks
// "수업 종료 인증 열기" (phase=check_out → "종료 인증") and students verify
// again. The QR + ultrasonic emitter work identically in both phases — only
// the active window rotates. Closing ends the session (phase=closed) and opens
// the 결석자 검토 popup.
export function QrSessionModal() {
  const session = useSessionStore((s) => s.session);
  const token = useSessionStore((s) => s.token);
  const extend = useSessionStore((s) => s.extend);
  const close = useSessionStore((s) => s.close);
  const openCheckout = useSessionStore((s) => s.openCheckout);
  const startTokenPolling = useSessionStore((s) => s.startTokenPolling);
  const stopTokenPolling = useSessionStore((s) => s.stopTokenPolling);
  const openReview = useSessionStore((s) => s.openReview);

  // Active = an auth window is open in either phase (not closed).
  const active = session?.phase === "check_in" || session?.phase === "check_out";
  const phase = session?.phase ?? "closed";

  // Emitter engine + minimal UI state.
  const emitterRef = useRef<UltrasonicEmitter | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [gain, setGain] = useState(0.6);
  const [audioError, setAudioError] = useState<string | null>(null);
  // Safari detection (excludes Chrome-on-iOS, Firefox-on-iOS, etc.).
  const isSafari =
    typeof navigator !== "undefined" &&
    /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  // Whether the AudioContext was unlocked + primed inside the "세션 열기" gesture.
  // If Safari is in use and this is false, Safari's autoplay policy is silently
  // blocking ALL Web Audio output (the badge says "송출 중" but no sound leaves
  // the speaker — even audible tones). Re-clicking "세션 열기" inside the gesture
  // usually clears it.
  const [audioUnlocked, setAudioUnlocked] = useState(isAudioUnlocked());
  useEffect(() => {
    if (emitting) setAudioUnlocked(isAudioUnlocked());
  }, [emitting]);

  // ---- DISPLAY-ONLY token TTL countdown -----------------------------------
  // The backend reuses a token for its full ~15s TTL and only rotates near
  // expiry, so the qr_token value (rotationKey) changes once per rotation — not
  // once per poll. Reset the countdown ONLY when the token actually rotates;
  // between rotations the 1s tick runs it down smoothly 15→0.
  //
  // IMPORTANT: the ring's `total` denominator is the FIXED nonce TTL (15s),
  // NOT token.expires_in. On a reuse poll the backend returns expires_in as the
  // real *remaining* TTL (e.g. 6 at the 9s poll). If we fed that as `total`,
  // the fraction would jump to remaining/remaining = 1 and the ring would snap
  // back to full at ~6s — the "시계가 6초에서 처음부터 다시 도는" bug. Keep total
  // constant so the arc only refills on an actual rotation (rotationKey change).
  const NONCE_TTL = 15;
  const rotationKey = token?.qr_token ?? token?.audio_nonce ?? "";
  const [ttlRemaining, setTtlRemaining] = useState(NONCE_TTL);
  useEffect(() => {
    setTtlRemaining(NONCE_TTL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationKey]);

  // ---- DISPLAY-ONLY auth-window countdown ---------------------------------
  const windowRemaining = session?.window_remaining ?? 0;
  const [windowTick, setWindowTick] = useState(windowRemaining);
  useEffect(() => {
    setWindowTick(windowRemaining);
  }, [windowRemaining, active]);

  // Local 1s tick for BOTH countdowns, floored at 0. Display only.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setTtlRemaining((s) => (s > 0 ? s - 1 : 0));
      setWindowTick((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  // 인증 창 남은 시간이 0s에 도달(자동 만료) → 결석자 검토 팝업 자동 오픈.
  // 세션 열기 직후 windowTick이 백엔드 값으로 동기화되기 전 잠시 0일 수 있으므로,
  // "카운트다운 중 0에 도달"(이전 > 0 → 현재 0)할 때만 트리거한다.
  const prevTickRef = useRef(windowTick);
  useEffect(() => {
    if (active && prevTickRef.current > 0 && windowTick <= 0) {
      openReview();
    }
    prevTickRef.current = windowTick;
  }, [active, windowTick, openReview]);

  // Token polling. The backend reuses a token for its full ~15s TTL and only
  // rotates near expiry. A 3s poll detects a rotation within ~3s and pushes
  // the new nonce to the emitter (which swaps at the next frame boundary — see
  // emitter.update()). 15s / 3s ≈ 5 checks per token; one of those catches the
  // rotation, then the next token's 15s cycle begins.
  useEffect(() => {
    if (active) startTokenPolling(3000);
    else stopTokenPolling();
    return () => stopTokenPolling();
  }, [active, startTokenPolling, stopTokenPolling]);

  function ensureEmitter(): UltrasonicEmitter {
    if (!emitterRef.current) {
      emitterRef.current = new UltrasonicEmitter(DEFAULT_PROTOCOL, { gain });
    }
    return emitterRef.current;
  }

  async function startEmitting() {
    if (!token?.audio_nonce) return;
    setAudioError(null);
    try {
      const em = ensureEmitter();
      em.setGain(gain);
      await em.start(token.audio_nonce);
      setEmitting(true);
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : String(e));
      setEmitting(false);
    }
  }

  function stopEmitting() {
    emitterRef.current?.stop();
    setEmitting(false);
  }

  // AUTO-EMIT: when the popup opens and the first token arrives, start
  // ultrasonic emission automatically. The "세션 열기" click that opened the
  // session (and this modal) counts as the user gesture unlocking AudioContext.
  useEffect(() => {
    if (active && token?.audio_nonce && !emitting) {
      void startEmitting();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, token?.audio_nonce]);

  // Push the rotated nonce to the running emitter.
  useEffect(() => {
    if (emitting && token?.audio_nonce) {
      emitterRef.current?.update(token.audio_nonce);
    }
  }, [emitting, token?.audio_nonce]);

  // Stop audio when the window closes or the modal unmounts.
  useEffect(() => {
    if (!active && emitting) stopEmitting();
  }, [active, emitting]);

  useEffect(() => {
    return () => {
      void emitterRef.current?.dispose();
      emitterRef.current = null;
    };
  }, []);

  // Live gain while emitting.
  useEffect(() => {
    emitterRef.current?.setGain(gain);
  }, [gain]);

  // Close the session (and thus the modal) when the professor clicks 닫기.
  async function onClose() {
    await close();
  }

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-session-title"
    >
      <div className="my-2 w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-4 shadow-soft-lg sm:p-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="qr-session-title"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <Radio className="h-5 w-5 text-primary" />
            {phase === "check_out" ? "종료 인증 송출 중" : "시작 인증 송출 중"}
            <Badge
              variant={phase === "check_out" ? "default" : "secondary"}
              className="gap-1"
            >
              {phase === "check_out" ? (
                <>
                  <LogOut className="h-3 w-3" /> 종료 인증
                </>
              ) : (
                <>
                  <LogIn className="h-3 w-3" /> 시작 인증
                </>
              )}
            </Badge>
            {emitting && (
              <Badge
                variant="success"
                className="gap-1 animate-soft-pulse motion-reduce:animate-none"
              >
                <Volume2 className="h-3 w-3" /> ♪ 초음파 송출
              </Badge>
            )}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onClose()}
            aria-label="세션 닫기"
          >
            <X className="h-4 w-4" /> 닫기
          </Button>
        </div>

        {/* SSE realtime panel — sits ABOVE the QR per the new layout. */}
        <RealtimeRiskPanel />

        {/* Large QR */}
        <div className="mt-4 flex flex-col items-center gap-4 rounded-xl border bg-muted/20 p-6">
          {token ? (
            <>
              <QRCodeSVG
                value={`${session!.session_id}|${token.qr_token}`}
                size={300}
                includeMargin
              />
              {/* Token rotation countdown + remaining window */}
              <div className="flex w-full max-w-md flex-col gap-2">
                <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <CountdownRing
                    remaining={ttlRemaining}
                    total={NONCE_TTL}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-medium">
                      회전 QR·음향 토큰
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {NONCE_TTL}초마다 자동 회전(단일 사용).
                      학생은 QR과 초음파를 동시에 인증합니다.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="flex items-center gap-2 text-sm">
                    <Timer className="h-4 w-4 text-muted-foreground" />
                    인증 창 남은 시간
                  </span>
                  <Badge variant={session!.window_open ? "default" : "secondary"}>
                    {windowTick}s
                  </Badge>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-[300px] w-[300px] items-center justify-center rounded bg-muted text-sm text-muted-foreground">
              토큰 대기 중…
            </div>
          )}
        </div>

        {/* Compact audio gain + window controls */}
        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <label className="flex items-center justify-between text-xs text-muted-foreground">
              <span>초음파 게인(도달거리)</span>
              <span className="font-mono">{Math.round(gain * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={gain}
              onChange={(e) => setGain(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
          {isSafari && !audioUnlocked && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              ⚠️ Safari에서 오디오 출력이 차단됐습니다(배지는 켜지지만 소리가 안 남).
              세션을 닫고 <strong>다시 "세션 열기"</strong>를 눌러주세요. 그래도 안 되면
              Chrome·Edge·Firefox 사용을 권장합니다.
            </p>
          )}
          {audioError && (
            <p className="text-xs text-destructive">오디오 오류: {audioError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => emitterRef.current?.playDiagTone(1000, 3)}
            >
              톤 1kHz (3s)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => emitterRef.current?.playDiagTone(18500, 5)}
            >
              톤 18.5kHz (5s)
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => void extend(60)}
            >
              창 +60초 연장
            </Button>
            {phase === "check_in" ? (
              <Button
                variant="default"
                className="flex-1"
                onClick={() => void openCheckout(60)}
              >
                수업 종료 인증 열기
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => void onClose()}
              >
                세션 닫기
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
