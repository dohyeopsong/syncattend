import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useSessionStore } from "@/store/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Radio, Timer, QrCode, Volume2, Play, Square } from "lucide-react";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { EmptyState } from "@/components/ui/empty-state";
import {
  UltrasonicEmitter,
  DEFAULT_PROTOCOL,
} from "@/lib/ultrasonicEmitter";

// Screen (a): live QR + REAL ultrasonic audio-nonce emitter with window controls.
// The audio nonce is physically transmitted via the Web Audio API using the
// protocol agreed with the mobile decoder (16 slots, 60 ms symbols, slot 15 =
// start marker, silent inter-symbol guard for adjacent nibbles).
//
// BAND: fixed at 17–18.5 kHz (DEFAULT_PROTOCOL). On-device TR-0 testing showed
// laptop speakers barely radiate 19–20 kHz (phone never saw the start marker →
// decode 0%); 17–18.5 kHz emits strongly (100% physical loopback) while 17 kHz
// keeps the audible 16 kHz out. B's decoder uses the same band, so this is the
// single supported band — no user-selectable presets.
export function SessionTokenPanel() {
  const session = useSessionStore((s) => s.session);
  const token = useSessionStore((s) => s.token);
  const extend = useSessionStore((s) => s.extend);
  const close = useSessionStore((s) => s.close);
  const startTokenPolling = useSessionStore((s) => s.startTokenPolling);
  const stopTokenPolling = useSessionStore((s) => s.stopTokenPolling);

  const active = session?.status === "open";

  // Emitter engine + UI state.
  const emitterRef = useRef<UltrasonicEmitter | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [gain, setGain] = useState(0.6);
  const [audioError, setAudioError] = useState<string | null>(null);

  // ---- DISPLAY-ONLY token TTL countdown -----------------------------------
  // The store owns polling + rotation; this is a purely visual per-second
  // countdown so the 15s rotation is *seen*. It reads token.expires_in and the
  // rotating token value, then ticks a local number down to 0. It never calls
  // a store action, never triggers a refresh, and never affects rotation.
  const rotationTtl = token?.expires_in ?? 0;
  const rotationKey = token?.qr_token ?? token?.audio_nonce ?? "";
  const [ttlRemaining, setTtlRemaining] = useState(rotationTtl);

  // Reset the visual countdown whenever the token rotates or a poll refreshes
  // expires_in (rotationKey / rotationTtl change).
  useEffect(() => {
    setTtlRemaining(rotationTtl);
  }, [rotationKey, rotationTtl]);

  // Local 1s tick, floored at 0. Display only; stops when inactive.
  useEffect(() => {
    if (!active || !token) return;
    const id = setInterval(() => {
      setTtlRemaining((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [active, token]);

  useEffect(() => {
    if (active) startTokenPolling(5000);
    else stopTokenPolling();
    return () => stopTokenPolling();
  }, [active, startTokenPolling, stopTokenPolling]);

  // Lazily create the emitter engine. Band is fixed at DEFAULT_PROTOCOL
  // (17–18.5 kHz) — the single device-verified band shared with B's decoder.
  function ensureEmitter(): UltrasonicEmitter {
    if (!emitterRef.current) {
      emitterRef.current = new UltrasonicEmitter(DEFAULT_PROTOCOL, { gain });
    }
    return emitterRef.current;
  }

  // Start/stop emission (requires a user gesture to unlock AudioContext).
  async function startEmitting() {
    if (!token?.audio_nonce) return;
    setAudioError(null);
    try {
      const em = ensureEmitter();
      em.setGain(gain);
      // repeatMs omitted → emitter default 600 ms (frame ≈540 ms, near-continuous).
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

  // Push new nonce to the running emitter whenever the token rotates.
  useEffect(() => {
    if (emitting && token?.audio_nonce) {
      emitterRef.current?.update(token.audio_nonce); // default 600 ms repeat
    }
  }, [emitting, token?.audio_nonce]);

  // Stop audio when the window closes or component unmounts.
  useEffect(() => {
    if (!active && emitting) stopEmitting();
  }, [active, emitting]);

  useEffect(() => {
    return () => {
      void emitterRef.current?.dispose();
      emitterRef.current = null;
    };
  }, []);

  // Live gain/band updates while emitting.
  useEffect(() => {
    emitterRef.current?.setGain(gain);
  }, [gain]);

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" /> 인증 토큰 송출
          </CardTitle>
          <CardDescription>
            강좌를 선택하고 세션을 열면 QR·음향 토큰이 여기에 표시됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            Icon={QrCode}
            title="송출할 세션이 없습니다"
            description="강좌를 선택하고 세션을 열면 회전 QR과 초음파 음향 토큰이 여기에서 송출됩니다."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" /> 인증 토큰 송출
          </CardTitle>
          {active ? (
            <Badge variant="success">열림</Badge>
          ) : (
            <Badge variant="secondary">닫힘</Badge>
          )}
        </div>
        <CardDescription>
          세션 <code className="font-mono">{session.session_id}</code> · 토큰은
          15초마다 회전(단일 사용)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/20 p-6">
          {active && token ? (
            // App expects "sessionId|qrToken" (raw.contains('|') → split).
            // Without session_id, verify sends an empty id → backend 404
            // "session not found" ("세션이 없다"). This is the real fix.
            <QRCodeSVG
              value={`${session.session_id}|${token.qr_token}`}
              size={200}
              includeMargin
            />
          ) : (
            <div className="flex h-[200px] w-[200px] items-center justify-center rounded bg-muted text-sm text-muted-foreground">
              토큰 대기 중…
            </div>
          )}
          {token && (
            <div className="w-full space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Volume2 className="h-4 w-4" />
                음향 nonce:{" "}
                <code className="font-mono text-foreground">
                  {token.audio_nonce}
                </code>
              </div>
              {/* Token TTL rotation, visualized (display only). */}
              <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <CountdownRing
                  remaining={ttlRemaining}
                  total={token.expires_in || 15}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Radio className="h-4 w-4 text-primary" /> 회전 QR·음향 토큰
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {token.expires_in || 15}초마다 자동 회전(단일 사용). 남은
                    시간이 0이 되면 새 토큰으로 교체됩니다.
                  </p>
                  {emitting && (
                    <Badge
                      variant="success"
                      className="gap-1 animate-soft-pulse motion-reduce:animate-none"
                    >
                      <Volume2 className="h-3 w-3" /> ♪ 초음파 송출 중
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Real ultrasonic emitter controls */}
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Volume2 className="h-4 w-4" /> 초음파 송출 (Web Audio)
            </div>
            {emitting ? (
              <Button size="sm" variant="destructive" onClick={stopEmitting}>
                <Square className="h-4 w-4" /> 정지
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!active || !token?.audio_nonce}
                onClick={() => void startEmitting()}
              >
                <Play className="h-4 w-4" /> 송출 시작
              </Button>
            )}
          </div>

          <div className="space-y-1">
            <label className="flex items-center justify-between text-xs text-muted-foreground">
              <span>게인(도달거리)</span>
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
            <p className="text-[11px] text-muted-foreground">
              대역 17–18.5kHz 고정(실기기 검증). 강의실이 크면 게인을 높여
              도달거리를 늘리세요. 근접성은 통과 여부(boolean)로만 판정되며 위치
              원자료는 수집하지 않습니다.
            </p>
          </div>

          {audioError && (
            <p className="text-xs text-destructive">
              오디오 오류: {audioError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm">
            <Timer className="h-4 w-4 text-muted-foreground" />
            인증 창 남은 시간
          </div>
          <Badge variant={session.window_open ? "default" : "secondary"}>
            {session.window_remaining}s
          </Badge>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={!active}
            onClick={() => void extend(60)}
          >
            창 +60초 연장
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={!active}
            onClick={() => void close()}
          >
            세션 닫기
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
