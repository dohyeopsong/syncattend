import { useEffect } from "react";
import { useSessionStore } from "@/store/session";
import { useAttendanceStore } from "@/store/attendance";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Activity, AlertTriangle, Wifi, WifiOff } from "lucide-react";

// Screen (d): realtime attendance stream via SSE (/sse/sessions/{id}).
// The professor sees the live present/unverified counts pushed by the backend,
// plus a derived risk banner when the unverified share is high.
export function RealtimeRiskPanel() {
  const session = useSessionStore((s) => s.session);
  const aggregate = useAttendanceStore((s) => s.aggregate);
  const sseConnected = useAttendanceStore((s) => s.sseConnected);
  const subscribeSse = useAttendanceStore((s) => s.subscribeSse);
  const unsubscribeSse = useAttendanceStore((s) => s.unsubscribeSse);

  const sessionId = session?.session_id;
  const isOpen = session?.status === "open";

  useEffect(() => {
    if (sessionId && isOpen) {
      subscribeSse(sessionId);
    }
    return () => unsubscribeSse();
  }, [sessionId, isOpen, subscribeSse, unsubscribeSse]);

  const total = aggregate?.total ?? 0;
  const present = aggregate?.present ?? 0;
  const unverified = aggregate?.unverified.length ?? 0;
  const unverifiedShare = total > 0 ? unverified / total : 0;

  const risk: { level: "info" | "warning" | "danger"; message: string } =
    unverifiedShare >= 0.5
      ? {
          level: "danger",
          message: `미인증 비율이 ${Math.round(unverifiedShare * 100)}%입니다. 인증 창 연장 또는 재송출을 검토하세요.`,
        }
      : unverifiedShare >= 0.2
        ? {
            level: "warning",
            message: `미인증 학생 ${unverified}명이 남아 있습니다.`,
          }
        : {
            level: "info",
            message: "출결이 정상 범위입니다.",
          };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> 실시간 모니터링 (SSE)
          </CardTitle>
          {sseConnected ? (
            <Badge variant="success" className="gap-1">
              <Wifi className="h-3 w-3" /> 연결됨
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <WifiOff className="h-3 w-3" /> 대기
            </Badge>
          )}
        </div>
        <CardDescription>
          서버가 밀어주는 실시간 출결 집계와 위험군 경고입니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={
            "flex items-start gap-2 rounded-lg border p-3 text-sm " +
            (risk.level === "danger"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : risk.level === "warning"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-success/30 bg-success/10 text-success")
          }
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">
              {risk.level === "danger"
                ? "위험 · "
                : risk.level === "warning"
                  ? "주의 · "
                  : "정상 · "}
            </span>
            {risk.message}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border p-3">
            <div className="text-xl font-bold">{total}</div>
            <div className="text-xs text-muted-foreground">전체</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xl font-bold text-success">{present}</div>
            <div className="text-xs text-muted-foreground">실시간 출석</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xl font-bold text-warning">{unverified}</div>
            <div className="text-xs text-muted-foreground">미인증</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
