import { useEffect } from "react";
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
import { Radio, Timer, QrCode, Volume2 } from "lucide-react";

// Screen (a): live QR + ultrasonic audio nonce emitter with window controls.
// Both tokens rotate every ~15s (single-use); we poll getSessionToken.
export function SessionTokenPanel() {
  const session = useSessionStore((s) => s.session);
  const token = useSessionStore((s) => s.token);
  const extend = useSessionStore((s) => s.extend);
  const close = useSessionStore((s) => s.close);
  const startTokenPolling = useSessionStore((s) => s.startTokenPolling);
  const stopTokenPolling = useSessionStore((s) => s.stopTokenPolling);

  const active = session?.status === "open";

  useEffect(() => {
    if (active) {
      startTokenPolling(5000);
    } else {
      stopTokenPolling();
    }
    return () => stopTokenPolling();
  }, [active, startTokenPolling, stopTokenPolling]);

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
              </div>
            </div>
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
