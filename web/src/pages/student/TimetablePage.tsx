// 시간표 tab — Everytime-style weekly grid built from enrolled courses.
//
// Mirrors the Flutter TimetableScreen (mobile/lib/features/courses/
// course_screens.dart): columns = weekdays (Mon–Fri min, expands to Sat/Sun),
// rows = class periods (1–9 min). Course blocks are pastel-colored with name +
// location; conflicting courses get a warning tint. Unscheduled courses appear
// as chips below the grid. The course search button opens a centered catalog
// modal for finding and adding courses.

import { useEffect, useMemo, useState } from "react";
import { useStudentCoursesStore } from "@/store/studentCourses";
import {
  courseColor,
  DAY_LABELS,
  flattenSchedules,
  maxDay,
  maxPeriod,
  slotsOverlap,
  unscheduledCourses,
} from "@/lib/studentTimetable";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { CourseCatalogSheet } from "./CourseCatalogSheet";
import type { CourseScheduleSlot, MyCourseItem } from "@/api/types";

export function TimetablePage() {
  const { myCourses, myCoursesStatus, loadMyCourses } = useStudentCoursesStore();
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    loadMyCourses();
  }, [loadMyCourses]);

  const slots = useMemo(() => flattenSchedules(myCourses), [myCourses]);
  const unscheduled = useMemo(() => unscheduledCourses(myCourses), [myCourses]);
  const periods = maxPeriod(myCourses);
  const lastDay = maxDay(myCourses);
  const days = DAY_LABELS.slice(0, lastDay + 1);

  // Detect overlapping slots for the warning tint + banner.
  const conflictSet = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slotsOverlap(slots[i].slot, slots[j].slot)) {
          ids.add(slots[i].slot.id);
          ids.add(slots[j].slot.id);
        }
      }
    }
    return ids;
  }, [slots]);

  const loading = myCoursesStatus === "loading";
  const hasConflict = conflictSet.size > 0;

  if (loading && myCourses.length === 0) {
    return (
      <div className="p-4">
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-24">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">내 시간표</h2>
          <p className="text-xs text-muted-foreground">2026년 2학기</p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => loadMyCourses()}
            aria-label="새로고침"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-haspopup="dialog"
            onClick={() => setCatalogOpen(true)}
          >
            <Plus className="h-4 w-4" /> 강좌 찾기
          </button>
        </div>
      </div>

      {hasConflict && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>시간이 겹치는 강의가 있습니다. 확인해주세요.</span>
        </div>
      )}

      {/* Weekly grid */}
      <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card shadow-soft">
        <div
          className="grid min-w-[640px]"
          style={{
            gridTemplateColumns: `36px repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          {/* Header row */}
          <div className="border-b border-r border-border/60" />
          {days.map((d) => (
            <div
              key={d}
              className="border-b border-border/60 py-2 text-center text-xs font-semibold text-muted-foreground"
            >
              {d}
            </div>
          ))}

          {/* Period rows */}
          {Array.from({ length: periods }, (_, p) => p + 1).map((period) => (
            <Row key={period}>
              {/* Period label column */}
              <div className="flex items-start justify-center border-r border-border/60 pt-1 text-xs text-muted-foreground">
                {period}
              </div>
              {days.map((_, dayIdx) => {
                const cellSlots = slots.filter(
                  (s) =>
                    s.slot.day_of_week === dayIdx &&
                    s.slot.start_period <= period &&
                    s.slot.end_period >= period,
                );
                return (
                  <Cell key={dayIdx} period={period} slots={cellSlots} conflictSet={conflictSet} />
                );
              })}
            </Row>
          ))}
        </div>
      </div>

      {/* Unscheduled course chips */}
      {unscheduled.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            일정 미지정 강의
          </p>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((c) => (
              <span
                key={c.id}
                className="rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs"
              >
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {catalogOpen && <CourseCatalogSheet onClose={() => setCatalogOpen(false)} />}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="contents">{children}</div>;
}

function Cell({
  period,
  slots,
  conflictSet,
}: {
  period: number;
  slots: { course: MyCourseItem; slot: CourseScheduleSlot }[];
  conflictSet: Set<string>;
}) {
  // Only render a block at the START period of each slot; the block spans the
  // full period range via grid-row on the absolute container. We render the
  // block as an absolutely-positioned overlay inside a relative cell so it can
  // overflow into lower rows.
  const starting = slots.filter((s) => s.slot.start_period === period);
  return (
    <div className="relative min-h-[44px] border-b border-r border-border/40 p-0.5">
      {starting.map(({ course, slot }) => {
        const colorIdx = Math.abs(hashStr(course.id)) % 8;
        const color = courseColor(colorIdx);
        const span = slot.end_period - slot.start_period + 1;
        const conflicted = conflictSet.has(slot.id);
        return (
          <div
            key={slot.id}
            className={`absolute inset-x-0.5 rounded-lg border px-1.5 py-1 text-[10px] leading-tight ${
              conflicted
                ? "border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100"
                : `${color.border} ${color.bg} ${color.text}`
            }`}
            style={{ top: 2, height: `calc(${span * 44}px + ${span - 1}px - 4px)` }}
            title={`${course.name}${course.location ? ` · ${course.location}` : ""}`}
          >
            <p className="truncate font-semibold">{course.name}</p>
            {course.location && (
              <p className="truncate opacity-80">{course.location}</p>
            )}
            {conflicted && (
              <AlertTriangle className="mt-0.5 h-3 w-3" />
            )}
          </div>
        );
      })}
      {/* render non-starting slots as empty (they're covered by the block above) */}
    </div>
  );
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
