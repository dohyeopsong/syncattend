// 내 출결 tab — course cards that expand into a per-week attendance table.
//
// Mirrors the Flutter MyAttendanceScreen (mobile/lib/features/views/
// view_screens.dart): lists enrolled courses as cards; selecting a course opens
// a bottom sheet with summary chips (출석/결석/지각/조퇴/대기) and a week-by-week
// table. On web the "bottom sheet" is a centered modal panel.

import { useEffect, useMemo, useState } from "react";
import { useStudentCoursesStore } from "@/store/studentCourses";
import { STATUS_META } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  AttendanceStatus,
  MyAttendanceItem,
  MyCourseItem,
} from "@/api/types";

// Group attendance rows by course for the card list + detail view.
interface CourseAttendance {
  course: MyCourseItem;
  rows: MyAttendanceItem[];
  counts: Record<AttendanceStatus, number>;
}

function summarize(rows: MyAttendanceItem[]): Record<AttendanceStatus, number> {
  const counts: Record<AttendanceStatus, number> = {
    present: 0,
    absent: 0,
    late: 0,
    early_leave: 0,
    pending: 0,
  };
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

export function MyAttendancePage() {
  const {
    myCourses,
    myCoursesStatus,
    attendance,
    attendanceStatus,
    loadMyCourses,
    loadAttendance,
  } = useStudentCoursesStore();

  const [selected, setSelected] = useState<CourseAttendance | null>(null);

  useEffect(() => {
    loadMyCourses();
    loadAttendance();
  }, [loadMyCourses, loadAttendance]);

  // Join enrolled courses with attendance rows by course_id.
  const grouped = useMemo<CourseAttendance[]>(() => {
    const byCourse = new Map<string, MyAttendanceItem[]>();
    for (const row of attendance) {
      const list = byCourse.get(row.course_id) ?? [];
      list.push(row);
      byCourse.set(row.course_id, list);
    }
    return myCourses.map((course) => {
      const rows = (byCourse.get(course.id) ?? []).slice().sort((a, b) => {
        const wa = a.week_number ?? 0;
        const wb = b.week_number ?? 0;
        return wa - wb;
      });
      return { course, rows, counts: summarize(rows) };
    });
  }, [myCourses, attendance]);

  const loading = myCoursesStatus === "loading" || attendanceStatus === "loading";

  function refresh() {
    void loadMyCourses();
    void loadAttendance();
  }

  if (loading && grouped.length === 0) {
    return (
      <div className="space-y-3 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          Icon={BookOpen}
          title="수강 중인 강좌가 없습니다"
          description="시간표 탭에서 수강신청을 진행해주세요."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">내 출결</h2>
          <p className="text-xs text-muted-foreground">
            강좌를 선택하면 주차별 출결 내역을 볼 수 있어요
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} aria-label="새로고침">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {grouped.map(({ course, rows, counts }) => {
        const absent = counts.absent;
        return (
          <button
            key={course.id}
            onClick={() =>
              setSelected({ course, rows, counts })
            }
            className="flex w-full items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 text-left shadow-soft transition-colors hover:border-primary/40"
          >
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{course.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[
                  course.code,
                  course.professor_name,
                  course.location,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <SummaryChip label="출석" n={counts.present} tone="success" />
                <SummaryChip label="결석" n={counts.absent} tone="destructive" />
                <SummaryChip label="지각" n={counts.late} tone="warning" />
                <SummaryChip label="조퇴" n={counts.early_leave} tone="warning" />
                <SummaryChip label="대기" n={counts.pending} tone="muted" />
              </div>
            </div>
            {absent > 0 && (
              <Badge variant="destructive" className="shrink-0">
                결석 {absent}
              </Badge>
            )}
          </button>
        );
      })}

      {selected && (
        <AttendanceDetailModal data={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function SummaryChip({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone: "success" | "destructive" | "warning" | "muted";
}) {
  const toneClass = {
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    destructive: "bg-destructive/10 text-destructive",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}
    >
      {label} {n}
    </span>
  );
}

function AttendanceDetailModal({
  data,
  onClose,
}: {
  data: CourseAttendance;
  onClose: () => void;
}) {
  const { course, rows, counts } = data;
  const maxWeek = rows.reduce((m, r) => Math.max(m, r.week_number ?? 0), 0);
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-t-2xl border bg-background shadow-soft-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{course.name}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {[
                course.code,
                course.department,
                course.professor_name,
                course.location,
                course.credits != null ? `${course.credits}학점` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2 p-4">
          <SummaryChip label="출석" n={counts.present} tone="success" />
          <SummaryChip label="결석" n={counts.absent} tone="destructive" />
          <SummaryChip label="지각" n={counts.late} tone="warning" />
          <SummaryChip label="조퇴" n={counts.early_leave} tone="warning" />
          <SummaryChip label="대기" n={counts.pending} tone="muted" />
        </div>

        {/* Week-by-week table */}
        <div className="max-h-[52vh] overflow-y-auto px-4 pb-4">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              출결 기록이 없습니다.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">주차</th>
                  <th className="py-2 pr-2 font-medium">1차 (시작)</th>
                  <th className="py-2 font-medium">2차 (종료)</th>
                  <th className="py-2 pl-2 text-right font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((wk) => {
                  const row = rows.find((r) => r.week_number === wk);
                  return (
                    <tr key={wk} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-medium">{wk}주차</td>
                      <td className="py-2 pr-2">
                        <CheckMark done={!!row?.check_in_verified_at} />
                      </td>
                      <td className="py-2">
                        <CheckMark done={!!row?.check_out_verified_at} />
                      </td>
                      <td className="py-2 pl-2 text-right">
                        {row ? (
                          <StatusBadge status={row.status} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckMark({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  ) : (
    <XCircle className="h-4 w-4 text-muted-foreground/40" />
  );
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.badgeVariant} className="gap-1">
      <meta.Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}
