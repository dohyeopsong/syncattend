// 수강신청 catalog sheet — searchable course catalog with enroll/unenroll.
//
// Mirrors the Flutter CourseCatalogSheet (mobile/lib/features/courses/
// course_screens.dart): a modal panel listing all offered courses with an
// `enrolled` flag. Search filters by name / professor / 학수번호. Enrolling in a
// course that overlaps an already-enrolled course triggers a client-side clash
// dialog (naming the conflicting course) before hitting the server.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStudentCoursesStore } from "@/store/studentCourses";
import { conflictingCourses } from "@/lib/studentTimetable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, X, Plus, Check, Loader2, AlertTriangle } from "lucide-react";
import type { CourseCatalogItem } from "@/api/types";

type FilterField = "all" | "name" | "professor" | "code";

const FILTERS: { value: FilterField; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "name", label: "강좌명" },
  { value: "professor", label: "교수명" },
  { value: "code", label: "학수번호" },
];

export function CourseCatalogSheet({ onClose }: { onClose: () => void }) {
  const {
    catalog,
    catalogStatus,
    catalogError,
    myCourses,
    enrollingId,
    loadCatalog,
    loadMyCourses,
    enroll,
    unenroll,
  } = useStudentCoursesStore();

  const [query, setQuery] = useState("");
  const [field, setField] = useState<FilterField>("all");
  const [clashCourse, setClashCourse] = useState<CourseCatalogItem | null>(null);

  useEffect(() => {
    loadMyCourses();
  }, [loadMyCourses]);

  // Load the complete catalog once. Search and field filtering stay local so
  // changing the query is immediate and never hides courses outside a server
  // result limit.
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((c) => {
      const targets = (() => {
        switch (field) {
          case "name":
            return [c.name];
          case "professor":
            return [c.professor_name ?? ""];
          case "code":
            return [c.code ?? ""];
          default:
            return [c.name, c.professor_name ?? "", c.code ?? ""];
        }
      })();
      return targets.some((t) => t.toLowerCase().includes(q));
    });
  }, [catalog, query, field]);

  async function onEnroll(c: CourseCatalogItem) {
    // Client-side clash pre-check: does any slot of this course overlap an
    // enrolled course? If so, show a dialog naming the conflict.
    const slots = c.schedules?.length
      ? c.schedules
      : c.day_of_week != null && c.start_period != null && c.end_period != null
        ? [
            {
              id: c.id,
              course_id: c.id,
              day_of_week: c.day_of_week,
              start_period: c.start_period,
              end_period: c.end_period,
            },
          ]
        : [];
    for (const slot of slots) {
      const conflicts = conflictingCourses(slot, myCourses);
      if (conflicts.length > 0) {
        setClashCourse(c);
        return;
      }
    }
    await enroll(c.id);
  }

  const loading = catalogStatus === "loading";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-course-catalog-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(760px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h3 id="student-course-catalog-title" className="text-base font-semibold">
              강좌 찾기
            </h3>
            <p className="text-xs text-muted-foreground">
              강좌명, 교수명 또는 학수번호로 검색한 뒤 시간표에 추가하세요.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Search + filter */}
        <div className="space-y-2 border-b p-4">
          <div className="flex gap-2">
            <select
              value={field}
              onChange={(e) => setField(e.target.value as FilterField)}
              className="h-11 rounded-xl border border-input bg-card px-2 text-sm shadow-soft focus-visible:border-primary/50 focus-visible:outline-none"
              aria-label="검색 기준"
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="강의 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && catalog.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : catalogStatus === "error" ? (
            <div className="space-y-3 py-10 text-center">
              <p className="text-sm text-destructive">
                강좌 목록을 불러오지 못했습니다.
              </p>
              {catalogError && (
                <p className="text-xs text-muted-foreground">{catalogError}</p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadCatalog(query)}
              >
                다시 시도
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              검색 결과가 없습니다.
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => (
                <CourseTile
                  key={c.id}
                  course={c}
                  enrolling={enrollingId === c.id}
                  onEnroll={() => void onEnroll(c)}
                  onUnenroll={() => void unenroll(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {clashCourse && (
        <ClashDialog
          courseName={clashCourse.name}
          onClose={() => setClashCourse(null)}
        />
      )}
    </div>,
    document.body,
  );
}

function CourseTile({
  course,
  enrolling,
  onEnroll,
  onUnenroll,
}: {
  course: CourseCatalogItem;
  enrolling: boolean;
  onEnroll: () => void;
  onUnenroll: () => void;
}) {
  const enrolled = course.enrolled;
  const scheduleLabel = formatSchedule(course);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{course.name}</p>
          {course.credits != null && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {course.credits}학점
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[
            course.code,
            course.professor_name,
            course.department,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {scheduleLabel && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {scheduleLabel}
            {course.location ? ` · ${course.location}` : ""}
          </p>
        )}
      </div>
      <div className="shrink-0">
        {enrolled ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onUnenroll}
            disabled={enrolling}
          >
            {enrolling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4" /> 담김
              </>
            )}
          </Button>
        ) : (
          <Button size="sm" onClick={onEnroll} disabled={enrolling}>
            {enrolling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4" /> 담기
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function ClashDialog({
  courseName,
  onClose,
}: {
  courseName: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-background p-5 shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5" />
          <h4 className="font-semibold">시간표 겹침</h4>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{courseName}</span>{" "}
          강의가 이미 담은 강의와 시간이 겹칩니다. 수강신청할 수 없습니다.
        </p>
        <Button className="mt-4 w-full" onClick={onClose}>
          확인
        </Button>
      </div>
    </div>
  );
}

function formatSchedule(c: CourseCatalogItem): string {
  if (c.schedules && c.schedules.length > 0) {
    return c.schedules
      .map((s) => `${"월화수목금토일"[s.day_of_week]} ${s.start_period}~${s.end_period}교시`)
      .join(", ");
  }
  if (c.day_of_week != null && c.start_period != null && c.end_period != null) {
    return `${"월화수목금토일"[c.day_of_week]} ${c.start_period}~${c.end_period}교시`;
  }
  return "";
}
