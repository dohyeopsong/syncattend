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
import {
  UltrasonicEmitter,
  DEFAULT_PROTOCOL,
} from "@/lib/ultrasonicEmitter";

// Preset ultrasonic bands (reach vs. audibility trade-off). The mobile decoder
// is band-agnostic — only bandLow/bandHigh differ — so these stay compatible.
// The FIRST preset is the runtime default (bandIdx=0) and MUST match the
// mobile decoder band. On-device TR-0 testing showed laptop speakers barely
// radiate 19–20 kHz (phone never saw the start marker → decode 0%), so the
// standard band was lowered to 17–18.5 kHz (strong emit + 100% physical
// loopback; 17 kHz keeps the audible 16 kHz out). Keep this aligned with
// DEFAULT_PROTOCOL in ultrasonicEmitter.ts and B's decoder.
const BAND_PRESETS = [
  { label: "17–18.5 kHz (표준·기기검증)", low: 17000, high: 18500 },
  { label: "17–19 kHz (도달 우선)", low: 17000, high: 19000 },
  { label: "18–20 kHz (조용/근거리·고사양 스피커)", low: 18000, high: 20000 },
];

// Screen (a): live QR + REAL ultrasonic audio-nonce emitter with window controls.
// The audio nonce is now physically transmitted via the Web Audio API using the
// protocol agreed with the mobile decoder (18–20 kHz, 16 slots, 60 ms symbols,
// slot 15 = start marker, silent inter-symbol guard for adjacent nibbles).
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
  const [bandIdx, setBandIdx] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    if (active) startTokenPolling(5000);
    else stopTokenPolling();
    return () => stopTokenPolling();
  }, [active, startTokenPolling, stopTokenPolling]);

  // Lazily create the emitter engine.
  function ensureEmitter(): UltrasonicEmitter {
    if (!emitterRef.current) {
      const band = BAND_PRESETS[bandIdx];
      emitterRef.current = new UltrasonicEmitter(
        { ...DEFAULT_PROTOCOL, bandLowHz: band.low, bandHighHz: band.high },
        { gain },
      );
    }
    return emitterRef.current;
  }

  // Start/stop emission (requires a user gesture to unlock AudioContext).
  async function startEmitting() {
    if (!token?.audio_nonce) return;
    setAudioError(null);
    try {
      const em = ensureEmitter();
      const band = BAND_PRESETS[bandIdx];
      em.setBand(band.low, band.high);
      em.setGain(gain);
      await em.start(token.audio_nonce, 1000);
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
      emitterRef.current?.update(token.audio_nonce, 1000);
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
            <QRCodeSVG value={token.qr_token} size={200} includeMargin />
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
              <div className="flex items-center gap-2 text-muted-foreground">
                <Radio className="h-4 w-4" /> TTL {token.expires_in}s · 회전 중
                {emitting && (
                  <Badge variant="success" className="ml-1">
                    ♪ 초음파 송출 중
                  </Badge>
                )}
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
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">주파수 대역</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={bandIdx}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setBandIdx(idx);
                const b = BAND_PRESETS[idx];
                emitterRef.current?.setBand(b.low, b.high);
              }}
            >
              {BAND_PRESETS.map((b, i) => (
                <option key={b.label} value={i}>
                  {b.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              강의실이 크면 게인↑/저역대(17–19kHz)로 도달거리를 늘리세요. 근접성은
              통과 여부(boolean)로만 판정되며 위치 원자료는 수집하지 않습니다.
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
