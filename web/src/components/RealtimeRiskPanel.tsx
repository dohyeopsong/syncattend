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
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatNumber } from "@/components/ui/stat-number";
import { Activity, AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { deriveAttendanceStats } from "@/lib/status";

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

  // Single source of truth for derived figures (see lib/status.ts).
  const { total, present, unverified, unverifiedShare, unverifiedRate } =
    deriveAttendanceStats(aggregate);

  const risk: { level: "info" | "warning" | "danger"; message: string } =
    unverifiedShare >= 0.5
      ? {
          level: "danger",
          message: `미인증 비율이 ${unverifiedRate}%입니다. 인증 창 연장 또는 재송출을 검토하세요.`,
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
        {!session ? (
          <EmptyState
            Icon={Activity}
            title="실시간 모니터링 대기 중"
            description="강좌를 선택하고 세션을 열면 서버가 밀어주는 실시간 출결 집계가 여기에 표시됩니다."
          />
        ) : !aggregate ? (
          // Session open, first aggregate not in yet → skeletons (no jump).
          <>
            <Skeleton className="h-12 w-full" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-lg border p-3">
                  <Skeleton className="mx-auto h-6 w-10" />
                  <Skeleton className="mx-auto mt-2 h-3 w-12" />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
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
              <div className="rounded-lg border p-4">
                <div className="text-2xl font-semibold leading-none">
                  <StatNumber value={total} />
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">전체</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-2xl font-semibold leading-none text-success">
                  <StatNumber value={present} />
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  실시간 출석
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-2xl font-semibold leading-none text-warning">
                  <StatNumber value={unverified} />
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  미인증
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
