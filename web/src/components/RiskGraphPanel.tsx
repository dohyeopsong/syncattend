import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, XCircle, HelpCircle, Triangle, LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AttendanceStatus } from "@/api/types";
import { useCoursesStore } from "@/store/courses";
import { useAttendanceStore } from "@/store/attendance";
import {
  riskScore,
  absentCount,
  lateCount,
  RISK_THRESHOLD,
  WEEKS,
  type StudentRow,
} from "@/lib/attendanceMatrix";

// F-grade risk heatmap (15-week × student grid).
//
// 15주차 수업, 학생 30~40명. 한눈에 보기 위해 가로=주차, 세로=학생,
// 칸 색=출결 상태인 히트맵으로 표현. 결석 누적이 위험선을 넘으면 해당
// 학생 행에 F 위험 표시를 준다.
//
// ⚠️ 현재 백엔드에 "강좌별 학생 누적 출결" API가 없어 아래 더미 데이터로
// 렌더링한다. CLI A가 누적 출결 집계 엔드포인트를 추가하면 `buildMatrix`
// 를 실제 응답을 파싱하는 코드로 교체하면 된다 (타입은 아래 참조).
//
// 위험 가중치(15주 기준, 임시):
//   결석   = 1.0 (F 커트라인: 보통 결석 5회 = F)
//   미인증 = 0.7 (잠재 결석)
//   지각   = 0.3
//   출석/조퇴 = 0
//   위험선 = 5.0

/** 히트맵 셀의 시각 메타. 색은 마크(칸)만 입히고, 텍스트는 토큰을 쓴다.
 *  render: "fill" = 색칠 칸, "icon" = 옅은 배경에 아이콘. */
const CELL_META: Record<
  AttendanceStatus,
  {
    bg: string;
    label: string;
    Icon: LucideIcon;
    render: "fill" | "icon";
    iconClass: string;
  }
> = {
  present: { bg: "bg-success/70", label: "출석", Icon: CheckCircle2, render: "fill", iconClass: "text-success" },
  // 지각: 노란색 세모 — 경고 의미.
  late: { bg: "bg-warning/10", label: "지각", Icon: Triangle, render: "icon", iconClass: "text-warning" },
  early_leave: { bg: "bg-warning/40", label: "조퇴", Icon: HelpCircle, render: "fill", iconClass: "text-warning" },
  // 결석: 빨간색 X — 위험 의미.
  absent: { bg: "bg-destructive/10", label: "결석", Icon: XCircle, render: "icon", iconClass: "text-destructive" },
  pending: { bg: "bg-muted-foreground/40", label: "미인증", Icon: HelpCircle, render: "fill", iconClass: "text-muted-foreground" },
};

export function RiskGraphPanel() {
  const courseId = useCoursesStore((s) => s.selectedCourseId);
  const courseName = useCoursesStore(
    (s) => s.courses.find((c) => c.id === s.selectedCourseId)?.name ?? null,
  );
  const matrix = useAttendanceStore((s) => s.matrix);
  const matrixLoading = useAttendanceStore((s) => s.matrixLoading);
  const matrixError = useAttendanceStore((s) => s.matrixError);
  const fetchMatrix = useAttendanceStore((s) => s.fetchMatrix);

  // Load the course-wide matrix whenever the selected course changes. Shared
  // with AbsenceRankChart via the store, so both panels fetch once per course.
  useEffect(() => {
    if (courseId) void fetchMatrix(courseId);
  }, [courseId, fetchMatrix]);

  const [hover, setHover] = useState<{ row: StudentRow; week: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const rows = matrix ?? [];
  const riskCount = rows.filter((r) => riskScore(r) >= RISK_THRESHOLD).length;
  const totalAbsent = rows.reduce((s, r) => s + absentCount(r), 0);
  const totalLate = rows.reduce((s, r) => s + lateCount(r), 0);
  const maxAbsent = Math.max(1, ...rows.map(absentCount));

  // 결석 많은 순 정렬(위험 가중 합계 내림차순).
  const sorted = rows
    .map((r) => ({ r }))
    .sort((a, b) => riskScore(b.r) - riskScore(a.r));
  // 더보기 전에는 학생별 상세(히트맵 표)를 숨긴다 — 요약만 노출.
  // 더보기 누르면 결석 많은 순으로 전체 학생 표가 펼쳐진다.
  const visible = expanded ? sorted : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> F 학점 위험 학생 출결 매트릭스
          </CardTitle>
          {courseId && !matrixLoading && !matrixError && rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 rounded-md border border-border bg-muted/50 px-2 text-xs text-muted-foreground hover:bg-muted"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "접기" : "자세히 보기"}
            </Button>
          )}
        </div>
        <CardDescription>
          {courseName
            ? `${courseName} — 15주차 전체 출결. 빨간 칸(결석)이 누적된 학생이 F 위험군이며, 위험선(결석 5회 상당)을 넘으면 행에 표시됩니다.`
            : "15주차 전체 출결을 한눈에. 빨간 칸(결석)이 누적된 학생이 F 위험군이며, 위험선(결석 5회 상당)을 넘으면 행에 표시됩니다."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* No course selected — prompt to pick one. */}
        {!courseId && (
          <EmptyState
            Icon={LayoutGrid}
            title="강좌를 선택하세요"
            description="선택한 강좌의 15주 출결 매트릭스가 표시됩니다."
          />
        )}
        {/* Loading */}
        {courseId && matrixLoading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-xl" />
          </div>
        )}
        {/* Error */}
        {courseId && !matrixLoading && matrixError && (
          <EmptyState
            Icon={AlertTriangle}
            title="불러오지 못했습니다"
            description={matrixError}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchMatrix(courseId, true)}
              >
                다시 시도
              </Button>
            }
          />
        )}
        {/* Data */}
        {courseId && !matrixLoading && !matrixError && rows.length > 0 && (
          <>
        {/* Legend — 상태별 색 안내 (칸 색 = 신원, 텍스트는 토큰). */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {(["present", "late", "early_leave", "absent", "pending"] as AttendanceStatus[]).map(
            (s) => {
              const meta = CELL_META[s];
              const Icon = meta.Icon;
              return (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-sm ${meta.bg}`}
                  >
                    {meta.render === "icon" && (
                      <Icon className={`h-2.5 w-2.5 ${meta.iconClass}`} aria-hidden="true" />
                    )}
                  </span>
                  {meta.label}
                </span>
              );
            },
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border border-border bg-card" />수업 없음
          </span>
        </div>

        {/* Headline tiles — 더보기 전에도 항상 표시. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile
            label="F 위험 학생"
            value={`${riskCount}명`}
            tone={riskCount > 0 ? "text-destructive" : "text-success"}
          />
          <SummaryTile
            label="결석 누계"
            value={`${totalAbsent}회`}
            tone="text-destructive"
          />
          <SummaryTile
            label="지각 누계"
            value={`${totalLate}회`}
            tone="text-warning"
          />
          <SummaryTile label="수강생" value={`${rows.length}명`} tone="text-foreground" />
        </div>

        {/* 학생별 상세 — 더보기 눌렀을 때만 표시. */}
        {expanded && (
          <>
            {/* Legend — 상태별 색 안내 (칸 색 = 신원, 텍스트는 토큰). */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {(["present", "late", "early_leave", "absent", "pending"] as AttendanceStatus[]).map(
                (s) => {
                  const meta = CELL_META[s];
                  const Icon = meta.Icon;
                  return (
                    <span key={s} className="inline-flex items-center gap-1.5">
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-sm ${meta.bg}`}
                      >
                        {meta.render === "icon" && (
                          <Icon className={`h-2.5 w-2.5 ${meta.iconClass}`} aria-hidden="true" />
                        )}
                      </span>
                      {meta.label}
                    </span>
                  );
                },
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm border border-border bg-card" />수업 없음
              </span>
            </div>

            {/* Heatmap — 가로 스크롤 가능한 그리드. 결석 많은 순 전체 학생. */}
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-card px-2 text-left font-medium text-muted-foreground">
                      학생
                    </th>
                    {Array.from({ length: WEEKS }, (_, i) => (
                      <th
                        key={i}
                        className="px-1 text-center font-medium text-muted-foreground"
                      >
                        {i + 1}
                      </th>
                    ))}
                    <th className="px-2 text-center font-medium text-muted-foreground">결석</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ r: row }) => {
                    const score = riskScore(row);
                    const atRisk = score >= RISK_THRESHOLD;
                    const absent = absentCount(row);
                    const absentPct = (absent / maxAbsent) * 100;
                    return (
                      <tr key={row.student_id}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-0.5">
                          <span className="inline-flex items-center gap-1.5">
                            {atRisk && (
                              <AlertTriangle
                                className="h-3 w-3 shrink-0 text-destructive"
                                aria-label="F 위험"
                              />
                            )}
                            <span className="font-medium">{row.name ?? "미상"}</span>
                            <span className="text-muted-foreground">
                              {row.student_number ?? ""}
                            </span>
                          </span>
                        </td>
                        {row.weeks.map((w, wi) => {
                          const isHover =
                            hover?.row === row && hover?.week === wi;
                          const meta = w ? CELL_META[w] : null;
                          const Icon = meta?.Icon;
                          return (
                            <td
                              key={wi}
                              className="p-0"
                              onMouseEnter={() => setHover({ row: row, week: wi })}
                              onMouseLeave={() => setHover(null)}
                            >
                              <div
                                role="img"
                                aria-label={
                                  meta ? `${row.name} ${wi + 1}주차 ${meta.label}` : "수업 없음"
                                }
                                className={`flex h-6 w-6 min-w-[1.5rem] items-center justify-center rounded-sm transition-all ${
                                  meta ? meta.bg : "border border-border bg-card"
                                } ${isHover ? "ring-2 ring-ring ring-offset-1 ring-offset-card" : ""}`}
                              >
                                {meta && meta.render === "icon" && Icon && (
                                  <Icon
                                    className={`h-3.5 w-3.5 ${meta.iconClass}`}
                                    aria-hidden="true"
                                  />
                                )}
                              </div>
                            </td>
                          );
                        })}
                        {/* 결석 누계 미니 바 — 위험일수록 진함. */}
                        <td className="px-2">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-10 overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${atRisk ? "bg-destructive" : "bg-muted-foreground/50"}`}
                                style={{ width: `${absentPct}%` }}
                              />
                            </div>
                            <span
                              className={`tabular-nums ${atRisk ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                            >
                              {absent}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Hover tooltip / detail */}
            {hover ? (
              <HoverDetail row={hover.row} week={hover.week + 1} />
            ) : (
              <p className="text-xs text-muted-foreground">
                칸에 마우스를 올리면 해당 주차 출결 정보가 표시됩니다. 빨간 칸이 많은
                학생일수록 F 위험이 큽니다.
              </p>
            )}
          </>
        )}

        <p className="text-[11px] text-muted-foreground">
          ※ 선택한 강좌의 누적 출결 데이터입니다. 진행 중인 주차는 확정 전까지
          대기(pending)로 표시됩니다.
        </p>
          </>
        )}
        {/* Course selected but no data yet (no enrolled students / sessions). */}
        {courseId && !matrixLoading && !matrixError && rows.length === 0 && (
          <EmptyState
            Icon={LayoutGrid}
            title="출결 기록이 없습니다"
            description="이 강좌에 아직 수강생 또는 세션 기록이 없습니다."
          />
        )}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3 text-center">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums leading-none ${tone}`}>
        {value}
      </div>
    </div>
  );
}

function HoverDetail({ row, week }: { row: StudentRow; week: number }) {
  const status = row.weeks[week - 1];
  if (!status) {
    return (
      <p className="text-xs text-muted-foreground">
        {row.name} · {week}주차: 해당 주차 수업 없음
      </p>
    );
  }
  const meta = CELL_META[status];
  const score = riskScore(row);
  const atRisk = score >= RISK_THRESHOLD;
  return (
    <p className="text-xs">
      <span className="font-medium">{row.name}</span>{" "}
      <span className="text-muted-foreground">{row.student_number}</span> · {week}주차{" "}
      <span className="inline-flex items-center gap-1">
        <meta.Icon className={`h-3 w-3 ${status === "absent" ? "text-destructive" : status === "late" || status === "early_leave" ? "text-warning" : status === "present" ? "text-success" : "text-muted-foreground"}`} />
        {meta.label}
      </span>
      {atRisk && (
        <span className="ml-2 inline-flex items-center gap-1 text-destructive">
          <AlertTriangle className="h-3 w-3" /> F 위험 (누적 위험점수 {score.toFixed(1)})
        </span>
      )}
    </p>
  );
}
