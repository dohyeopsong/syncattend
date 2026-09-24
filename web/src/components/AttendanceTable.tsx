import { useEffect } from "react";
import { useSessionStore } from "@/store/session";
import { useAttendanceStore } from "@/store/attendance";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AttendanceStatus } from "@/api/types";
import { CheckCircle2, XCircle, Clock, RefreshCw, ClipboardCheck } from "lucide-react";

// Screen (b): Opt-out absentee-centric table. Under Opt-out, verified students
// are present by default; the professor only reviews the *unverified* list and
// applies corrections. Corrections are queued as Deltas.
// Screen (c): Delta batch close applies only the queued changes.
export function AttendanceTable() {
  const session = useSessionStore((s) => s.session);
  const aggregate = useAttendanceStore((s) => s.aggregate);
  const pendingDeltas = useAttendanceStore((s) => s.pendingDeltas);
  const fetchAggregate = useAttendanceStore((s) => s.fetchAggregate);
  const setDelta = useAttendanceStore((s) => s.setDelta);
  const clearDelta = useAttendanceStore((s) => s.clearDelta);
  const batchClose = useAttendanceStore((s) => s.batchClose);

  const sessionId = session?.session_id;

  useEffect(() => {
    if (sessionId) void fetchAggregate(sessionId);
  }, [sessionId, fetchAggregate]);

  if (!session || !aggregate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" /> Opt-out 결석자 검토
          </CardTitle>
          <CardDescription>세션을 열면 출결 집계가 표시됩니다.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const unverified = aggregate.unverified;
  const pendingCount = Object.keys(pendingDeltas).length;
  const rate =
    aggregate.total > 0
      ? Math.round((aggregate.present / aggregate.total) * 100)
      : 0;

  const statusFor = (studentId: string): AttendanceStatus =>
    pendingDeltas[studentId] ?? "pending";

  function StatusBadge({ studentId }: { studentId: string }) {
    const st = statusFor(studentId);
    if (st === "present") return <Badge variant="success">출석 처리</Badge>;
    if (st === "absent") return <Badge variant="destructive">결석 확정</Badge>;
    return <Badge variant="warning">미인증(검토 대기)</Badge>;
  }

  async function onBatchClose() {
    if (!sessionId) return;
    const ok = await batchClose(sessionId);
    if (ok) await fetchAggregate(sessionId);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" /> Opt-out 결석자 검토
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => sessionId && void fetchAggregate(sessionId)}
          >
            <RefreshCw className="h-4 w-4" /> 새로고침
          </Button>
        </div>
        <CardDescription>
          인증 통과자는 자동 출석(Opt-out). 아래 미인증 명단만 확인·정정하세요.
          위치 원자료는 수집·표시하지 않으며, 근접성은 통과 여부로만 반영됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">{aggregate.total}</div>
            <div className="text-xs text-muted-foreground">전체 인원</div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">
              {aggregate.present}
            </div>
            <div className="text-xs text-muted-foreground">출석 ({rate}%)</div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">
              {unverified.length}
            </div>
            <div className="text-xs text-muted-foreground">미인증</div>
          </div>
        </div>

        {/* Absentee-centric list */}
        {unverified.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> 미인증 학생이 없습니다. 전원
            자동 출석 처리되었습니다.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">학번(student_id)</th>
                  <th className="px-4 py-2 font-medium">상태</th>
                  <th className="px-4 py-2 text-right font-medium">정정</th>
                </tr>
              </thead>
              <tbody>
                {unverified.map((studentId) => (
                  <tr key={studentId} className="border-t">
                    <td className="px-4 py-2 font-mono">{studentId}</td>
                    <td className="px-4 py-2">
                      <StatusBadge studentId={studentId} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant={
                            statusFor(studentId) === "present"
                              ? "default"
                              : "outline"
                          }
                          onClick={() => setDelta(studentId, "present")}
                        >
                          <CheckCircle2 className="h-4 w-4" /> 출석
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            statusFor(studentId) === "absent"
                              ? "destructive"
                              : "outline"
                          }
                          onClick={() => setDelta(studentId, "absent")}
                        >
                          <XCircle className="h-4 w-4" /> 결석
                        </Button>
                        {pendingDeltas[studentId] && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => clearDelta(studentId)}
                          >
                            <Clock className="h-4 w-4" /> 대기
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Screen (c): Delta batch close */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
          <div className="text-sm text-muted-foreground">
            대기 중 정정(Delta):{" "}
            <span className="font-semibold text-foreground">
              {pendingCount}건
            </span>
          </div>
          <Button disabled={pendingCount === 0} onClick={() => void onBatchClose()}>
            Delta 마감 적용
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
