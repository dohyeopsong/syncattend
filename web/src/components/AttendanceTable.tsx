import { useEffect, useState } from "react";
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
import type { AttendanceDelta } from "@/api/types";
import { exportSessionAttendanceUrl } from "@/api/client";
import { statusMeta, deriveAttendanceStats } from "@/lib/status";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckCircle2, XCircle, Clock, ClipboardCheck, AlertTriangle, Download } from "lucide-react";

// Screen (b): Opt-out absentee-centric table. Under Opt-out, verified students
// are present by default; the professor only reviews the *unverified* list and
// applies corrections. Corrections are queued as Deltas.
// Screen (c): 출석 마감 (final close) — commits the binary present/absent split.
// Everyone not marked present is auto-set absent so the session ends with a
// complete 출석/결석 record. If any unverified student is still unmarked
// (대기/미인증), a confirm popup warns how many will be auto-absent first.
export function AttendanceTable() {
  const session = useSessionStore((s) => s.session);
  const closeReview = useSessionStore((s) => s.closeReview);
  const aggregate = useAttendanceStore((s) => s.aggregate);
  const pendingDeltas = useAttendanceStore((s) => s.pendingDeltas);
  const fetchAggregate = useAttendanceStore((s) => s.fetchAggregate);
  const setDelta = useAttendanceStore((s) => s.setDelta);
  const clearDelta = useAttendanceStore((s) => s.clearDelta);
  const batchClose = useAttendanceStore((s) => s.batchClose);

  const sessionId = session?.session_id;
  const [closing, setClosing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (sessionId) void fetchAggregate(sessionId);
  }, [sessionId, fetchAggregate]);

  if (!session || !aggregate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" /> 결석자 검토
          </CardTitle>
          <CardDescription>세션을 열면 출결 집계가 표시됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {!session ? (
            <EmptyState
              Icon={ClipboardCheck}
              title="검토할 세션이 없습니다"
              description="강좌를 선택하고 세션을 열면 인증 미통과(미인증) 학생 명단이 여기에 표시됩니다."
            />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const unverified = aggregate.unverified;
  const pendingCount = Object.keys(pendingDeltas).length;
  // Single source of truth for derived figures (see lib/status.ts).
  const stats = deriveAttendanceStats(aggregate, pendingDeltas);

  const statusFor = (studentId: string) =>
    pendingDeltas[studentId] ?? "pending";

  function StatusBadge({ studentId }: { studentId: string }) {
    const s = statusFor(studentId);
    const meta = statusMeta(s);
    const { Icon } = meta;
    return (
      <Badge variant={meta.badgeVariant} className="gap-1">
        <Icon className="h-3 w-3" />
        {s === "pending" ? "미인증(검토 대기)" : meta.label}
      </Badge>
    );
  }

  // Build the final binary split: present (already verified on the server, plus
  // any unverified the professor marked present) vs absent (everyone else).
  // Unverified students who were never marked (대기/미인증) are auto-absent.
  function buildFinalDeltas(): {
    deltas: AttendanceDelta[];
    autoAbsent: string[]; // students auto-set absent (were unmarked)
    presentCount: number;
    absentCount: number;
  } {
    const deltas: AttendanceDelta[] = [];
    const autoAbsent: string[] = [];
    for (const u of unverified) {
      const sid = u.student_id;
      const marked = pendingDeltas[sid];
      if (marked === "present") {
        deltas.push({ student_id: sid, status: "present" });
      } else if (marked === "absent") {
        deltas.push({ student_id: sid, status: "absent" });
      } else {
        // 대기/미인증 → auto absent
        deltas.push({ student_id: sid, status: "absent" });
        autoAbsent.push(sid);
      }
    }
    const presentCount = (aggregate?.present ?? 0) + deltas.filter((d) => d.status === "present").length;
    const absentCount = deltas.filter((d) => d.status === "absent").length;
    return { deltas, autoAbsent, presentCount, absentCount };
  }

  const preview = buildFinalDeltas();

  async function doClose() {
    if (!sessionId) return;
    setClosing(true);
    // Ensure the auto-absent students are in the Delta queue before sending.
    for (const sid of preview.autoAbsent) setDelta(sid, "absent");
    const ok = await batchClose(sessionId);
    if (ok) {
      await fetchAggregate(sessionId);
      // 마감 완료 → 결석자 검토 팝업 닫기 (데이터는 DB에 저장됨).
      setConfirmOpen(false);
      closeReview();
    }
    setClosing(false);
  }

  function onCloseClick() {
    // If there are unmarked students, confirm before auto-absenting them.
    if (preview.autoAbsent.length > 0) {
      setConfirmOpen(true);
    } else {
      void doClose();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" /> 결석자 검토
          </CardTitle>
          {sessionId && (
            <a
              href={exportSessionAttendanceUrl(sessionId)}
              download
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Download className="h-4 w-4" /> JSON 내보내기
            </a>
          )}
        </div>
        <CardDescription>
          인증 통과자는 자동 출석(Opt-out). 아래 미인증 명단만 확인·정정하세요.
          위치 원자료는 수집·표시하지 않으며, 근접성은 통과 여부로만 반영됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary — live tiles reflecting queued corrections in real time */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">전체 인원</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-success/5 p-3 text-center">
            <div className="text-2xl font-bold text-success">
              {stats.presentFinal}
            </div>
            <div className="text-xs text-muted-foreground">
              출석 ({stats.presentRate}%)
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-destructive/5 p-3 text-center">
            <div className="text-2xl font-bold text-destructive">
              {stats.absentFinal}
            </div>
            <div className="text-xs text-muted-foreground">
              결석 ({stats.absentFinalRate}%)
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-warning/5 p-3 text-center">
            <div className="text-2xl font-bold text-warning">
              {stats.unverifiedFinal}
            </div>
            <div className="text-xs text-muted-foreground">
              미인증 ({stats.unverifiedFinalRate}%)
            </div>
          </div>
        </div>

        {/* Absentee-centric list */}
        {unverified.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/50">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            미인증 학생이 없습니다. 전원 자동 출석 처리되었습니다.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">학번</th>
                  <th className="px-4 py-2.5 font-medium">이름</th>
                  <th className="px-4 py-2.5 font-medium">상태</th>
                  <th className="px-4 py-2.5 text-right font-medium">정정</th>
                </tr>
              </thead>
              <tbody>
                {unverified.map((u) => {
                  const sid = u.student_id;
                  return (
                    <tr key={sid} className="border-t border-border/60 transition-colors hover:bg-accent/40">
                      <td className="px-4 py-2.5 font-mono">
                        {u.student_number ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.name ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge studentId={sid} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant={
                              statusFor(sid) === "present"
                                ? "default"
                                : "outline"
                            }
                            onClick={() => setDelta(sid, "present")}
                          >
                            <CheckCircle2 className="h-4 w-4" /> 출석
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              statusFor(sid) === "absent"
                                ? "destructive"
                                : "outline"
                            }
                            onClick={() => setDelta(sid, "absent")}
                          >
                            <XCircle className="h-4 w-4" /> 결석
                          </Button>
                          {pendingDeltas[sid] && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => clearDelta(sid)}
                            >
                              <Clock className="h-4 w-4" /> 대기
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Screen (c): 출석 마감 — final binary close */}
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="text-sm text-muted-foreground">
            대기 중 정정(Delta):{" "}
            <span className="font-semibold text-foreground">
              {pendingCount}건
            </span>
            <span className="ml-2 text-muted-foreground/80">
              · 마감 시 미확정자 자동 결석
            </span>
          </div>
          <Button disabled={closing || stats.total === 0} onClick={onCloseClick}>
            {closing ? "마감 중…" : "출석 마감"}
          </Button>
        </div>
      </CardContent>

      {/* Confirm popup: auto-absent the unmarked students */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-confirm-title"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-soft-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 id="close-confirm-title" className="text-base font-semibold">
                  출석 마감 확인
                </h2>
                <p className="text-sm text-muted-foreground">
                  출석 <span className="font-semibold text-success">{preview.presentCount}명</span>
                  {" · "}결석 <span className="font-semibold text-destructive">{preview.absentCount}명</span>
                  으로 확정합니다.
                </p>
              </div>
            </div>

            {preview.autoAbsent.length > 0 && (
              <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                미확정(대기·미인증){" "}
                <span className="font-semibold">{preview.autoAbsent.length}명</span>
                이 자동으로 결석 처리됩니다.
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                취소
              </Button>
              <Button onClick={() => void doClose()}>
                <CheckCircle2 className="h-4 w-4" /> 마감 확정
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
