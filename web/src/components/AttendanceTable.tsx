import { useEffect, useMemo, useState } from "react";
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
import type {
  AttendanceDelta,
  AttendanceStatus,
  RosterStudent,
} from "@/api/types";
import { exportSessionAttendanceUrl } from "@/api/client";
import { statusMeta } from "@/lib/status";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  AlertTriangle,
  Download,
  LogOut,
  Timer,
  RotateCcw,
  Minus,
} from "lucide-react";

// 결석자 검토 (review) page — rebuilt around the DB's 1차/2차 structure.
//
// The session's AttendanceAggregate now carries a full `roster`: every enrolled
// student with their raw 1차 (check_in_done) / 2차 (check_out_done) result and a
// derived status:
//   both passed   -> present  (출석)
//   check_in only -> early_leave (조퇴)
//   check_out only-> late     (지각)
//   neither       -> absent (after close) / pending (before close)
//
// The table shows the whole roster so the professor can see, per student, which
// phase they passed and override the final status (Delta) before 출석 마감.
// Corrections are queued as Deltas and committed at batch close; students still
// pending (대기) with no override are auto-set absent at close time.

// Sort rank: needs-attention first. Applied to the EFFECTIVE status (Delta
// override wins over the derived status) so a professor's correction moves a
// student down the list immediately.
const SORT_RANK: Record<AttendanceStatus, number> = {
  pending: 0, // 대기 — needs a decision
  absent: 1,
  early_leave: 2,
  late: 3,
  present: 4,
};

export function AttendanceTable() {
  const session = useSessionStore((s) => s.session);
  const closeReview = useSessionStore((s) => s.closeReview);
  const openCheckout = useSessionStore((s) => s.openCheckout);
  const resetSession = useSessionStore((s) => s.reset);
  const aggregate = useAttendanceStore((s) => s.aggregate);
  const pendingDeltas = useAttendanceStore((s) => s.pendingDeltas);
  const fetchAggregate = useAttendanceStore((s) => s.fetchAggregate);
  const setDelta = useAttendanceStore((s) => s.setDelta);
  const clearDelta = useAttendanceStore((s) => s.clearDelta);
  const batchClose = useAttendanceStore((s) => s.batchClose);

  const sessionId = session?.session_id;
  const [closing, setClosing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reopening, setReopening] = useState(false);

  // Whether the 2차 (종료) 인증 can still be opened: the session is closed AND
  // check_out has NOT been opened yet (phase went check_in → closed directly).
  // Once check_out was opened (even if later closed), the second phase is done.
  const canOpenCheckout =
    !!session && session.phase === "closed" && !session.checkout_opened;

  async function onOpenCheckout() {
    if (!session) return;
    setReopening(true);
    // Close the review popup so the QR modal (re-opened by openCheckout) is the
    // top-most layer — the two popups must not overlap.
    closeReview();
    await openCheckout(60);
    setReopening(false);
  }

  useEffect(() => {
    if (sessionId) void fetchAggregate(sessionId);
  }, [sessionId, fetchAggregate]);

  // The effective status for a roster student: a queued Delta overrides the
  // server-derived status. This is what the badge + sort + tiles reflect.
  const effectiveStatus = (s: RosterStudent): AttendanceStatus =>
    pendingDeltas[s.student_id] ?? s.status;

  // Sorted roster: needs-attention first, then by school student number.
  const roster = aggregate?.roster ?? [];
  const sortedRoster = useMemo(() => {
    return [...roster].sort((a, b) => {
      const ra = SORT_RANK[effectiveStatus(a)];
      const rb = SORT_RANK[effectiveStatus(b)];
      if (ra !== rb) return ra - rb;
      return (a.student_number ?? a.student_id).localeCompare(
        b.student_number ?? b.student_id,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, pendingDeltas]);

  // Live tiles computed from the roster + queued Deltas (self-consistent with
  // the table — corrections on ANY student, not just the pending ones, reflect
  // here immediately). present/미출석/미인증 partition the whole roster.
  const tiles = useMemo(() => {
    let present = 0,
      absent = 0,
      earlyLeave = 0,
      late = 0,
      pending = 0;
    for (const s of roster) {
      const f = effectiveStatus(s);
      if (f === "present") present++;
      else if (f === "absent") absent++;
      else if (f === "early_leave") earlyLeave++;
      else if (f === "late") late++;
      else pending++;
    }
    const total = roster.length;
    const partial = earlyLeave + late; // 1차만 / 2차만
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    return { total, present, absent, earlyLeave, late, pending, partial, pct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, pendingDeltas]);

  const pendingCount = Object.keys(pendingDeltas).length;

  // Build the final Delta set for batch close. Queued overrides are sent as-is;
  // students still pending (대기) with no override are auto-set absent. Students
  // with a resolved derived status (present/early_leave/late/absent) and no
  // override need NO delta — the backend derives them from the timestamps.
  function buildFinalDeltas(): {
    deltas: AttendanceDelta[];
    autoAbsent: string[];
    presentCount: number;
    absentCount: number;
  } {
    const deltas: AttendanceDelta[] = [];
    const autoAbsent: string[] = [];
    let presentCount = 0;
    let absentCount = 0;
    for (const s of roster) {
      const queued = pendingDeltas[s.student_id];
      // At close time, pending (대기) students with no override become absent.
      const finalStatus: AttendanceStatus =
        queued ?? (s.status === "pending" ? "absent" : s.status);
      if (queued) {
        deltas.push({ student_id: s.student_id, status: queued });
      } else if (s.status === "pending") {
        deltas.push({ student_id: s.student_id, status: "absent" });
        autoAbsent.push(s.student_id);
      }
      if (finalStatus === "present") presentCount++;
      else if (finalStatus === "absent") absentCount++;
    }
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
      // 마감 완료 → 현재 라운드 인증이 DB에 저장됨. 세션을 완전히 리셋하여
      // QR 모달/토큰 폴링이 남지 않게 하고, 결석자 검토 팝업도 닫는다.
      setConfirmOpen(false);
      resetSession();
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
              description="강좌를 선택하고 세션을 열면 전체 학생의 1차·2차 인증 결과가 여기에 표시됩니다."
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
          1차(시작)·2차(종료) 인증 결과로 최종 출결이 자동 확정됩니다. 둘 다
          통과=출석, 1차만=조퇴, 2차만=지각, 둘 다 없음=결석. 필요 시 학생별로
          상태를 정정한 뒤 출석 마감하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary tiles — live, reflect queued corrections in real time */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-bold">{tiles.total}</div>
            <div className="text-xs text-muted-foreground">전체 인원</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-success/5 p-3 text-center">
            <div className="text-2xl font-bold text-success">
              {tiles.present}
            </div>
            <div className="text-xs text-muted-foreground">
              출석 ({tiles.pct(tiles.present)}%)
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-warning/5 p-3 text-center">
            <div className="text-2xl font-bold text-warning">
              {tiles.partial}
            </div>
            <div className="text-xs text-muted-foreground">
              조퇴·지각 ({tiles.pct(tiles.partial)}%)
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-destructive/5 p-3 text-center">
            <div className="text-2xl font-bold text-destructive">
              {tiles.absent + tiles.pending}
            </div>
            <div className="text-xs text-muted-foreground">
              결석·대기 ({tiles.pct(tiles.absent + tiles.pending)}%)
            </div>
          </div>
        </div>

        {/* Full roster table — 1차/2차 per student + derived status + correction */}
        {sortedRoster.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
              <ClipboardCheck className="h-4 w-4" />
            </span>
            수강생이 없습니다. 학생을 등록하면 출결 명단이 표시됩니다.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">학번</th>
                  <th className="px-4 py-2.5 font-medium">이름</th>
                  <th className="px-4 py-2.5 text-center font-medium">1차</th>
                  <th className="px-4 py-2.5 text-center font-medium">2차</th>
                  <th className="px-4 py-2.5 font-medium">출결 상태</th>
                  <th className="px-4 py-2.5 text-right font-medium">정정</th>
                </tr>
              </thead>
              <tbody>
                {sortedRoster.map((s) => {
                  const sid = s.student_id;
                  const eff = effectiveStatus(s);
                  const meta = statusMeta(eff);
                  const EffIcon = meta.Icon;
                  const overridden = !!pendingDeltas[sid];
                  return (
                    <tr
                      key={sid}
                      className="border-t border-border/60 transition-colors hover:bg-accent/40"
                    >
                      <td className="px-4 py-2.5 font-mono">
                        {s.student_number ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">{s.name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-center">
                        <PhaseMark done={s.check_in_done} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <PhaseMark done={s.check_out_done} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={meta.badgeVariant}
                          className="gap-1"
                          title={
                            overridden ? "정정된 상태 (마감 시 확정)" : undefined
                          }
                        >
                          <EffIcon className="h-3 w-3" />
                          {meta.label}
                          {overridden && (
                            <span className="ml-0.5 text-[10px] opacity-70">
                              정정
                            </span>
                          )}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <CorrectButton
                            icon={CheckCircle2}
                            label="출석"
                            active={eff === "present"}
                            variant="success"
                            onClick={() => setDelta(sid, "present")}
                          />
                          <CorrectButton
                            icon={LogOut}
                            label="조퇴"
                            active={eff === "early_leave"}
                            variant="warning"
                            onClick={() => setDelta(sid, "early_leave")}
                          />
                          <CorrectButton
                            icon={Timer}
                            label="지각"
                            active={eff === "late"}
                            variant="warning"
                            onClick={() => setDelta(sid, "late")}
                          />
                          <CorrectButton
                            icon={XCircle}
                            label="결석"
                            active={eff === "absent"}
                            variant="destructive"
                            onClick={() => setDelta(sid, "absent")}
                          />
                          {overridden && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="px-2"
                              onClick={() => clearDelta(sid)}
                              title="자동 판정으로 되돌리기"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
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

        {/* 2차 (종료) 인증 열기 — only when the session is closed after 1차 and
            the check_out phase has NOT yet been opened. Re-opens the SAME
            session so attendance aggregation stays intact (present=both,
            early_leave=1차 only, late=2차 only, absent=neither). */}
        {canOpenCheckout && (
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="text-sm">
              <span className="font-medium text-foreground">2차(종료) 인증 대기</span>
              <span className="ml-2 text-muted-foreground">
                · 수업 종료 후 종료 인증을 열면 최종 출결이 확정됩니다
              </span>
            </div>
            <Button
              variant="default"
              disabled={reopening}
              onClick={() => void onOpenCheckout()}
            >
              <LogOut className="h-4 w-4" />
              {reopening ? "여는 중…" : "2차 인증 열기"}
            </Button>
          </div>
        )}

        {/* 출석 마감 — final close */}
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="text-sm text-muted-foreground">
            대기 중 정정(Delta):{" "}
            <span className="font-semibold text-foreground">
              {pendingCount}건
            </span>
            <span className="ml-2 text-muted-foreground/80">
              · 마감 시 미확정(대기)자 자동 결석
            </span>
          </div>
          <Button disabled={closing || tiles.total === 0} onClick={onCloseClick}>
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
                  출석{" "}
                  <span className="font-semibold text-success">
                    {preview.presentCount}명
                  </span>
                  {" · "}결석{" "}
                  <span className="font-semibold text-destructive">
                    {preview.absentCount}명
                  </span>
                  으로 확정합니다.
                </p>
              </div>
            </div>

            {preview.autoAbsent.length > 0 && (
              <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                미확정(대기){" "}
                <span className="font-semibold">
                  {preview.autoAbsent.length}명
                </span>
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

// 1차/2차 phase indicator: green check when passed, gray dash when not.
function PhaseMark({ done }: { done: boolean }) {
  if (done) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success/10 text-success">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Minus className="h-4 w-4" />
    </span>
  );
}

// Compact correction toggle button. `active` highlights the currently-effective
// status; `variant` tints the active state.
function CorrectButton({
  icon: Icon,
  label,
  active,
  variant,
  onClick,
}: {
  icon: typeof CheckCircle2;
  label: string;
  active: boolean;
  variant: "success" | "warning" | "destructive";
  onClick: () => void;
}) {
  const activeClass =
    variant === "success"
      ? "border-success bg-success/10 text-success"
      : variant === "destructive"
        ? "border-destructive bg-destructive/10 text-destructive"
        : "border-warning bg-warning/10 text-warning";
  return (
    <Button
      size="sm"
      variant={active ? "outline" : "ghost"}
      className={`h-7 gap-1 px-2 text-xs ${active ? activeClass : ""}`}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}
