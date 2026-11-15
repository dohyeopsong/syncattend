import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useCoursesStore, type SearchField } from "@/store/courses";
import { useSessionStore } from "@/store/session";
import { useAttendanceStore } from "@/store/attendance";
import { unlockAudio } from "@/lib/ultrasonicEmitter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  Course,
  CourseCatalogItem,
  CourseScheduleSlot,
  CreateCourseRequest,
  DayOfWeek,
  ScheduleSlotInput,
  UpdateCourseRequest,
} from "@/api/types";
import { estimateSession, listCourseSchedules } from "@/api/client";
import { estimateLocally } from "@/lib/sessionEstimate";
import { BookOpen, Pencil, Play, Plus, Search, Trash2, Users, X } from "lucide-react";

// day_of_week: 0=Mon … 6=Sun (per contract).
const DAY_LABELS: Record<DayOfWeek, string> = {
  0: "월",
  1: "화",
  2: "수",
  3: "목",
  4: "금",
  5: "토",
  6: "일",
};

const DAY_OPTIONS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

// Format a CourseScheduleSlot as "월 1교시" / "화 2~3교시" for the dropdown.
function slotLabel(s: CourseScheduleSlot): string {
  const day = DAY_LABELS[s.day_of_week];
  return s.start_period === s.end_period
    ? `${day} ${s.start_period}교시`
    : `${day} ${s.start_period}~${s.end_period}교시`;
}

// Period rule: 1..12교시, each 60 min, 1교시 starts 09:00.
// N교시 start hour = 8 + N (1교시 → 09:00 … 12교시 → 20:00).
const PERIOD_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

function periodStartHour(period: number): number {
  return 8 + period;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// "3교시 (11:00~12:00)"
function periodLabel(period: number): string {
  const start = periodStartHour(period);
  return `${period}교시 (${pad2(start)}:00~${pad2(start + 1)}:00)`;
}

// Small debounce hook — returns the value after it has been stable for `ms`.
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// One editable weekly slot in the form (all strings for controlled inputs;
// converted to typed payload on submit). A course can have several of these
// (e.g. 월 1~2교시 + 화 3~4교시) — multi-day support.
interface Slot {
  day_of_week: string; // "" | "0".."6"
  start_period: string; // "" | "1".."12"
  end_period: string; // "" | "1".."12"
}

// Editable fields shared by the add + edit forms (all strings for controlled
// inputs; converted to typed payload on submit).
interface CourseForm {
  name: string;
  code: string;
  department: string;
  professor_name: string;
  slots: Slot[]; // weekly time slots (one per day the course meets)
  location: string;
  credits: string;
  semester_start_date: string; // ISO date (YYYY-MM-DD) or ""
}

export type { CourseForm, Slot };

const EMPTY_SLOT: Slot = { day_of_week: "", start_period: "", end_period: "" };

const EMPTY_FORM: CourseForm = {
  name: "",
  code: "",
  department: "",
  professor_name: "",
  slots: [],
  location: "",
  credits: "",
  semester_start_date: "",
};

// Build form slots from a course's normalized schedules. Falls back to the
// scalar columns (legacy / single-day course with no schedule rows).
function slotsFromSchedules(
  schedules: CourseScheduleSlot[] | undefined,
  fallbackDay: DayOfWeek | null,
  fallbackStart: number | null,
  fallbackEnd: number | null,
): Slot[] {
  if (schedules && schedules.length > 0) {
    return schedules.map((s) => ({
      day_of_week: String(s.day_of_week),
      start_period: String(s.start_period),
      end_period: String(s.end_period),
    }));
  }
  if (fallbackDay != null) {
    return [
      {
        day_of_week: String(fallbackDay),
        start_period: fallbackStart != null ? String(fallbackStart) : "",
        end_period: fallbackEnd != null ? String(fallbackEnd) : "",
      },
    ];
  }
  return [];
}

function courseToForm(c: Course): CourseForm {
  return {
    name: c.name ?? "",
    code: c.code ?? "",
    department: c.department ?? "",
    professor_name: c.professor_name ?? "",
    slots: slotsFromSchedules(
      c.schedules,
      c.day_of_week,
      c.start_period,
      c.end_period,
    ),
    location: c.location ?? "",
    credits: c.credits != null ? String(c.credits) : "",
    semester_start_date: c.semester_start_date ?? "",
  };
}

// Empty string → null; numeric strings → number. Keeps optional fields sparse.
// `schedules` is always emitted (possibly empty) so create reconciles to the
// full slot set and PATCH clears slots when the professor removes all rows.
export function formToPayload(f: CourseForm): CreateCourseRequest {
  const str = (v: string) => (v.trim() === "" ? null : v.trim());
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const complete = f.slots.filter(
    (s) => s.day_of_week !== "" && s.start_period !== "" && s.end_period !== "",
  );
  const schedules: ScheduleSlotInput[] = complete.map((s) => ({
    day_of_week: Number(s.day_of_week) as DayOfWeek,
    start_period: Number(s.start_period),
    end_period: Number(s.end_period),
  }));
  // Mirror the scalar columns from the first complete slot (backward compat
  // for consumers that still read day_of_week/start_period/end_period).
  const first = complete[0];
  return {
    name: f.name.trim(),
    code: str(f.code),
    department: str(f.department),
    professor_name: str(f.professor_name),
    day_of_week: first ? (Number(first.day_of_week) as DayOfWeek) : null,
    start_period: first ? Number(first.start_period) : null,
    end_period: first ? Number(first.end_period) : null,
    location: str(f.location),
    credits: num(f.credits),
    semester_start_date: str(f.semester_start_date),
    schedules,
  };
}

// Fill the add form from a selected catalog item (all weekly slots carried
// over; the professor can edit/add/remove them before submitting).
function catalogItemToForm(item: CourseCatalogItem): CourseForm {
  return {
    name: item.name ?? "",
    code: item.code ?? "",
    department: item.department ?? "",
    professor_name: item.professor_name ?? "",
    slots: slotsFromSchedules(
      item.schedules,
      item.day_of_week,
      item.start_period,
      item.end_period,
    ),
    location: item.location ?? "",
    credits: item.credits != null ? String(item.credits) : "",
    semester_start_date: "",
  };
}

// Front-end validation across all slots. A slot that has any field set must be
// fully filled; start must be <= end.
export function periodError(f: CourseForm): string | null {
  for (const s of f.slots) {
    const hasAny = s.day_of_week !== "" || s.start_period !== "" || s.end_period !== "";
    if (!hasAny) continue;
    if (s.day_of_week === "" || s.start_period === "" || s.end_period === "") {
      return "요일·시작 교시·종료 교시를 모두 선택하세요.";
    }
    if (Number(s.start_period) > Number(s.end_period)) {
      return "시작 교시는 종료 교시보다 앞서야 합니다.";
    }
  }
  return null;
}

function scheduleLabel(c: Course): string {
  if (c.schedules && c.schedules.length > 0) {
    return c.schedules.map(slotLabel).join(", ") || "—";
  }
  if (c.day_of_week == null && c.start_period == null) return "—";
  const day = c.day_of_week != null ? DAY_LABELS[c.day_of_week] : "";
  let periods = "";
  if (c.start_period != null) {
    periods =
      c.end_period != null && c.end_period !== c.start_period
        ? `${c.start_period}–${c.end_period}교시`
        : `${c.start_period}교시`;
  }
  return [day, periods].filter(Boolean).join(" ") || "—";
}

// Shared add/edit form fields.
function CourseFields({
  form,
  setForm,
}: {
  form: CourseForm;
  setForm: (f: CourseForm) => void;
}) {
  const upd = (patch: Partial<CourseForm>) => setForm({ ...form, ...patch });

  const updateSlot = (i: number, patch: Partial<Slot>) =>
    setForm({
      ...form,
      slots: form.slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    });
  const addSlot = () => setForm({ ...form, slots: [...form.slots, { ...EMPTY_SLOT }] });
  const removeSlot = (i: number) =>
    setForm({ ...form, slots: form.slots.filter((_, idx) => idx !== i) });

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          강좌명 <span className="text-destructive">*</span>
        </label>
        <Input
          placeholder="예: 소프트웨어공학"
          value={form.name}
          onChange={(e) => upd({ name: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          학수번호
        </label>
        <Input
          placeholder="SW3001"
          value={form.code}
          onChange={(e) => upd({ code: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          학과
        </label>
        <Input
          placeholder="소프트웨어학과"
          value={form.department}
          onChange={(e) => upd({ department: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          담당교수
        </label>
        <Input
          placeholder="홍길동"
          value={form.professor_name}
          onChange={(e) => upd({ professor_name: e.target.value })}
        />
      </div>

      {/* Weekly slots — one row per day the course meets. Each row pairs a
          요일 with its own 시작/종료 교시 so multi-day courses (월 1~2 + 화 3~4)
          can be expressed. Add/remove rows freely. */}
      <div className="col-span-2 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            요일 · 교시
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSlot}
            className="h-7"
          >
            <Plus className="h-3.5 w-3.5" /> 요일 추가
          </Button>
        </div>
        {form.slots.length === 0 && (
          <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            “요일 추가”를 눌러 수업 시간을 등록하세요. (여러 요일 추가 가능)
          </p>
        )}
        {form.slots.map((slot, i) => (
          <div key={i} className="flex items-end gap-1.5">
            <div className="w-20 space-y-1">
              <label className="text-[11px] text-muted-foreground">요일</label>
              <select
                className="flex h-10 w-full rounded-xl border border-input bg-card px-2 py-2 text-sm shadow-soft"
                value={slot.day_of_week}
                onChange={(e) => updateSlot(i, { day_of_week: e.target.value })}
              >
                <option value="">선택</option>
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[11px] text-muted-foreground">시작 교시</label>
              <select
                className="flex h-10 w-full rounded-xl border border-input bg-card px-2 py-2 text-sm shadow-soft"
                value={slot.start_period}
                onChange={(e) => updateSlot(i, { start_period: e.target.value })}
              >
                <option value="">선택</option>
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[11px] text-muted-foreground">종료 교시</label>
              <select
                className="flex h-10 w-full rounded-xl border border-input bg-card px-2 py-2 text-sm shadow-soft"
                value={slot.end_period}
                onChange={(e) => updateSlot(i, { end_period: e.target.value })}
              >
                <option value="">선택</option>
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeSlot(i)}
              aria-label="요일 삭제"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {periodError(form) && (
          <p className="text-[11px] text-destructive">{periodError(form)}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          강의실
        </label>
        <Input
          placeholder="공학관 401"
          value={form.location}
          onChange={(e) => upd({ location: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          학점
        </label>
        <Input
          type="number"
          min={0}
          max={9}
          placeholder="3"
          value={form.credits}
          onChange={(e) => upd({ credits: e.target.value })}
        />
      </div>
      <div className="col-span-2 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          학기 시작일 (1주차 월요일)
        </label>
        <Input
          type="date"
          value={form.semester_start_date}
          onChange={(e) => upd({ semester_start_date: e.target.value })}
        />
        <p className="text-[11px] text-muted-foreground">
          세션 생성 시 주차 자동 추정에 사용됩니다.
        </p>
      </div>
    </div>
  );
}

// Debounced catalog-search combobox. Typing a course or professor name queries
// GET /courses/catalog?q= and shows candidates; selecting one auto-fills the
// add form. No results → the manual "직접 입력" fields below stay usable.
function CatalogSearch({
  onSelect,
}: {
  onSelect: (item: CourseCatalogItem) => void;
}) {
  const catalog = useCoursesStore((s) => s.catalog);
  const catalogLoading = useCoursesStore((s) => s.catalogLoading);
  const searchCatalog = useCoursesStore((s) => s.searchCatalog);
  const clearCatalog = useCoursesStore((s) => s.clearCatalog);
  const courses = useCoursesStore((s) => s.courses);

  const [query, setQuery] = useState("");
  const [field, setField] = useState<SearchField>("all");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query, 300);
  const boxRef = useRef<HTMLDivElement>(null);

  // Keys of courses the professor already added, so an already-added catalog
  // entry can't be re-added. Key matches the dedup key in searchCatalog:
  // code → fallback to name → fallback to id.
  const addedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const c of courses) {
      s.add((c.code ?? c.name ?? c.id).toLowerCase());
    }
    return s;
  }, [courses]);

  useEffect(() => {
    void searchCatalog(debounced, field);
  }, [debounced, field, searchCatalog]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const showDropdown = open && query.trim().length > 0;
  const noResults = !catalogLoading && debounced.trim().length > 0 && catalog.length === 0;

  // Placeholder reflects the chosen search field.
  const placeholder =
    field === "name"
      ? "강좌명 입력…"
      : field === "professor_name"
        ? "교수명 입력…"
        : field === "code"
          ? "학수번호 입력…"
          : "강좌명·교수명·학수번호 입력…";

  return (
    <div className="relative space-y-1" ref={boxRef}>
      <label className="text-xs font-medium text-muted-foreground">
        강좌·교수 검색 (자동완성)
      </label>
      <div className="flex gap-2">
        {/* Search-by selector: narrow the autocomplete to one field. */}
        <select
          className="h-10 shrink-0 rounded-xl border border-input bg-card px-2 text-sm shadow-soft"
          value={field}
          onChange={(e) => setField(e.target.value as SearchField)}
          aria-label="검색 기준"
        >
          <option value="all">전체</option>
          <option value="name">강좌명</option>
          <option value="professor_name">교수명</option>
          <option value="code">학수번호</option>
        </select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls="catalog-listbox"
            autoComplete="off"
          />
        </div>
      </div>

      {showDropdown && (
        <ul
          id="catalog-listbox"
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-border/60 bg-card shadow-soft-lg"
        >
          {catalogLoading && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              검색 중…
            </li>
          )}
          {noResults && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              검색 결과가 없습니다. 아래에서 직접 입력하세요.
            </li>
          )}
          {catalog.map((item) => {
            const isAdded = addedKeys.has(
              (item.code ?? item.name ?? item.id).toLowerCase(),
            );
            return (
              <li key={item.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  disabled={isAdded}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                  onClick={() => {
                    onSelect(item);
                    setQuery("");
                    setOpen(false);
                    clearCatalog();
                  }}
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {item.name}
                    {item.code && (
                      <Badge variant="outline">{item.code}</Badge>
                    )}
                    {isAdded && (
                      <Badge variant="secondary">이미 추가됨</Badge>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {item.professor_name && <span>{item.professor_name}</span>}
                    {item.department && <span>{item.department}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Course picker + CRUD + "open session" trigger. Opening a session starts screen (a).
export function CoursePanel() {
  const courses = useCoursesStore((s) => s.courses);
  const fetchCourses = useCoursesStore((s) => s.fetchCourses);
  const addCourse = useCoursesStore((s) => s.addCourse);
  const updateCourse = useCoursesStore((s) => s.updateCourse);
  const deleteCourse = useCoursesStore((s) => s.deleteCourse);
  const coursesError = useCoursesStore((s) => s.error);
  // Enrollment (product decision #2): professor view is READ-ONLY. We only
  // read the roster via fetchEnrollments/enrollments; student self-enroll is
  // owned by mobile (B), so no enroll button/input is exposed here.
  const enrollments = useCoursesStore((s) => s.enrollments);
  const fetchEnrollments = useCoursesStore((s) => s.fetchEnrollments);
  const setSelectedCourse = useCoursesStore((s) => s.setSelectedCourse);

  const session = useSessionStore((s) => s.session);
  const openSession = useSessionStore((s) => s.openSession);
  const openCheckoutById = useSessionStore((s) => s.openCheckoutById);
  const resetSession = useSessionStore((s) => s.reset);
  const resetAttendance = useAttendanceStore((s) => s.reset);

  const [selected, setSelected] = useState<string>("");
  // Roster visibility is a separate toggle from course selection: clicking a
  // different course shows its roster; clicking the same course again hides it.
  const [rosterOpen, setRosterOpen] = useState(false);
  const [windowSeconds, setWindowSeconds] = useState(60);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<CourseForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CourseForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  // Open-session confirmation: estimate (week + slot) is fetched on "세션 열기"
  // and the professor confirms/edits before the session is actually created.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [schedules, setSchedules] = useState<CourseScheduleSlot[]>([]);
  const [chosenWeek, setChosenWeek] = useState<number | null>(null);
  const [chosenScheduleId, setChosenScheduleId] = useState<string | null>(null);
  const [estimateLabel, setEstimateLabel] = useState<string | null>(null);
  // 1차(check_in) vs 2차(check_out) selection. Defaults to the server's
  // suggestion: if a closed session for this week+slot already has 1차 done,
  // the estimate returns suggested_phase="check_out" + pending_session_id.
  const [chosenPhase, setChosenPhase] = useState<"check_in" | "check_out">("check_in");
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  // Whether the add form already matches an existing course (by code, fallback
  // name). Used to disable the submit button and warn on direct manual entry.
  const addDupKey = (addForm.code?.trim() || addForm.name.trim()).toLowerCase();
  const alreadyExists =
    addDupKey.length > 0 &&
    courses.some(
      (c) => (c.code ?? c.name ?? c.id).toLowerCase() === addDupKey,
    );

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === selected),
    [courses, selected],
  );

  useEffect(() => {
    void fetchCourses();
  }, [fetchCourses]);

  // Do NOT auto-select the first course on load. The professor must explicitly
  // pick a course — the F-risk matrix / trend chart only load after a click, so
  // the dashboard lands on an empty "강좌를 선택하세요" state instead of showing
  // the first course's data unprompted.

  // Keep the shared selectedCourseId in the store in sync so the simulation
  // panel (on a separate nav page) targets the same course the professor picked.
  useEffect(() => {
    setSelectedCourse(selected || null);
  }, [selected, setSelectedCourse]);

  // Close the add-course modal on Escape.
  useEffect(() => {
    if (!showAdd) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAdd(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showAdd]);

  // Load the roster whenever the selected course changes (read-only view).
  useEffect(() => {
    if (selected) void fetchEnrollments(selected);
  }, [selected, fetchEnrollments]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim()) return;
    if (periodError(addForm)) return; // start<=end guard
    // Block re-adding a course the professor already has (by code, fallback
    // name). Matches the dedup/added key used in CatalogSearch so direct
    // manual entry can't bypass the disabled autocomplete option.
    if (alreadyExists) return;
    setBusy(true);
    const c = await addCourse(formToPayload(addForm));
    setBusy(false);
    if (c) {
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      setSelected(c.id);
    }
  }

  function startEdit(c: Course) {
    setEditingId(c.id);
    setEditForm(courseToForm(c));
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingId || !editForm.name.trim()) return;
    if (periodError(editForm)) return; // start<=end guard
    setBusy(true);
    const payload: UpdateCourseRequest = formToPayload(editForm);
    const updated = await updateCourse(editingId, payload);
    setBusy(false);
    if (updated) setEditingId(null);
  }

  async function onDelete(c: Course) {
    // Irreversible — require explicit confirmation.
    const ok = window.confirm(
      `강좌 "${c.name}"을(를) 삭제하시겠습니까?\n삭제 후에는 되돌릴 수 없습니다.`,
    );
    if (!ok) return;
    setBusy(true);
    const done = await deleteCourse(c.id);
    setBusy(false);
    if (done && selected === c.id) setSelected("");
  }

  async function onOpen() {
    if (!selected) return;
    // Unlock the AudioContext INSIDE this click gesture, before any network
    // request, and AWAIT it (never `void`). Safari only permits audio output
    // from a context that finished resume() within the gesture; if the gesture
    // expires first (e.g. `void unlockAudio()` then `await openSession()`),
    // Safari silently blocks ALL output — even audible 1kHz tones — while still
    // reporting state="running". Chrome is lenient. Awaiting here guarantees
    // resume() + the silent-prime buffer finish before the network round-trips
    // consume the gesture window.
    await unlockAudio();
    // Open-session confirmation: pre-fill week + slot from the CURRENT KST time
    // + the course's semester_start_date + its schedule rows. The week/slot
    // estimation runs LOCALLY in the browser (lib/sessionEstimate.ts) so the
    // modal fills instantly without a network round-trip — the professor
    // confirms/edits before the session is actually created.
    setEstimating(true);
    setConfirmOpen(true);
    setChosenWeek(null);
    setChosenScheduleId(null);
    setEstimateLabel(null);
    setChosenPhase("check_in");
    setPendingSessionId(null);
    try {
      const slots = await listCourseSchedules(selected);
      setSchedules(slots);
      // Local time-based estimate — no backend dependency. Fills immediately.
      const local = estimateLocally(
        selectedCourse?.semester_start_date ?? null,
        slots,
      );
      setChosenWeek(local.weekNumber);
      setChosenScheduleId(local.scheduleId);
      setEstimateLabel(local.scheduleLabel);
      // 2차 auto-detection: ask the backend whether a closed session for this
      // week+slot already has 1차 done (so we default to 2차). This is a DB
      // lookup the browser can't do locally — but if it fails, the week/slot
      // are already filled above and the professor can pick 1차/2차 manually.
      try {
        const est = await estimateSession(selected);
        setChosenPhase(est.suggested_phase);
        setPendingSessionId(est.pending_session_id);
      } catch {
        // Backend unavailable → default to 1차 (already set above).
      }
    } catch {
      // Schedule fetch failed — still let the professor pick manually.
      setSchedules([]);
    } finally {
      setEstimating(false);
    }
  }

  async function confirmOpenSession() {
    if (!selected) return;
    setBusy(true);
    resetAttendance();
    if (chosenPhase === "check_out" && pendingSessionId) {
      // 2차: re-open the EXISTING closed session for check_out. The week/slot
      // are already set on that session, so only the window length matters.
      await openCheckoutById(pendingSessionId, windowSeconds);
    } else {
      // 1차: create a brand-new session with the chosen week + slot.
      await openSession(selected, {
        windowSeconds,
        weekNumber: chosenWeek,
        scheduleId: chosenScheduleId,
      });
    }
    setBusy(false);
    setConfirmOpen(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" /> 강좌 관리 & 세션
        </CardTitle>
        <CardDescription>
          강좌를 추가·수정·삭제하고, 강좌를 선택해 인증 창(기본 60초)을 열어
          세션을 시작하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ---- course list ---- */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">강좌 목록</label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowAdd(true);
                setAddForm(EMPTY_FORM);
              }}
            >
              <Plus className="h-4 w-4" /> 강좌 추가
            </Button>
          </div>

          {courses.length === 0 && !showAdd && (
            <p className="rounded-xl border border-dashed border-border/70 bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              등록된 강좌가 없습니다. “강좌 추가”로 시작하세요.
            </p>
          )}

          <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
            {courses.map((c) => {
              const isSelected = c.id === selected;
              const isEditing = c.id === editingId;
              return (
                <li key={c.id} className="p-3">
                  {isEditing ? (
                    <form onSubmit={onSaveEdit} className="space-y-3">
                      <CourseFields form={editForm} setForm={setEditForm} />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                        >
                          취소
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={
                            busy ||
                            !editForm.name.trim() ||
                            !!periodError(editForm)
                          }
                        >
                          저장
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          className="flex-1 text-left"
                          onClick={() => {
                            if (c.id === selected) {
                              // Same course clicked again → toggle roster closed.
                              setRosterOpen((v) => !v);
                            } else {
                              // Different course → select it and show its roster.
                              setSelected(c.id);
                              setRosterOpen(true);
                            }
                          }}
                          aria-pressed={isSelected}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            {isSelected && (
                              <Badge variant="default">선택됨</Badge>
                            )}
                            {c.code && (
                              <Badge variant="outline">{c.code}</Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {c.department && <span>{c.department}</span>}
                            <span>{scheduleLabel(c)}</span>
                            {c.location && <span>{c.location}</span>}
                            {c.credits != null && <span>{c.credits}학점</span>}
                            {c.professor_name && <span>{c.professor_name}</span>}
                          </div>
                        </button>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label="강좌 수정"
                            onClick={() => startEdit(c)}
                            disabled={busy}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label="강좌 삭제"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void onDelete(c)}
                            disabled={busy}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Roster expands inline under this course (강의1 → 명단 → 강의2). */}
                      {isSelected && rosterOpen && (
                        <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-sm font-medium">
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Users className="h-4 w-4" />
                              </span>
                              수강생
                              <Badge variant="secondary">
                                {enrollments[c.id]
                                  ? `${enrollments[c.id]!.length}명`
                                  : "…"}
                              </Badge>
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              조회 전용 · 수강신청은 학생 앱에서
                            </span>
                          </div>
                          {!enrollments[c.id] ? (
                            <p className="text-xs text-muted-foreground">
                              불러오는 중…
                            </p>
                          ) : enrollments[c.id]!.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              아직 수강생이 없습니다.
                            </p>
                          ) : (
                            <ul className="flex flex-wrap gap-1.5">
                              {enrollments[c.id]!.map((e) => (
                                <li key={e.student_id}>
                                  <Badge variant="outline" className="font-mono">
                                    {/* Prefer the school student number (joined
                                        from the user); bots surface as
                                        "SIMbot…". Fall back to the user id. */}
                                    {e.student_number ?? e.student_id}
                                  </Badge>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* ---- add form (modal) ---- */}
        {showAdd && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => {
              // Close when clicking the backdrop (not its children).
              if (e.target === e.currentTarget) setShowAdd(false);
            }}
          >
            <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-card p-4 shadow-soft-lg">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">새 강좌 추가</p>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setShowAdd(false)}
                  aria-label="닫기"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <form onSubmit={onCreate} className="space-y-3">
                {/* Autocomplete: pick from the catalog to auto-fill, then adjust
                    요일/교시. If no match, fill the fields below manually. */}
                <CatalogSearch
                  onSelect={(item) => setAddForm(catalogItemToForm(item))}
                />
                <p className="text-[11px] text-muted-foreground">
                  검색 결과가 없으면 아래에서 직접 입력하세요.
                </p>
                <CourseFields form={addForm} setForm={setAddForm} />
                {alreadyExists && (
                  <p className="text-[11px] text-destructive">
                    이미 추가된 강좌입니다. 같은 학수번호(또는 강좌명)의 강좌는 중복 추가할 수 없습니다.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowAdd(false)}
                  >
                    취소
                  </Button>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={
                      busy ||
                      !addForm.name.trim() ||
                      !!periodError(addForm) ||
                      alreadyExists
                    }
                  >
                    <Plus className="h-4 w-4" /> 추가
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ---- open-session confirmation: estimated week + slot ---- */}
        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-soft-lg">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">세션 정보 확인</p>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setConfirmOpen(false)}
                  aria-label="닫기"
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {estimating ? (
                <p className="text-sm text-muted-foreground">
                  현재 시각 기준 주차·교시를 추정 중…
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {selectedCourse ? `“${selectedCourse.name}” ` : ""}세션을
                    시작합니다. 추정된 주차·교시를 확인 또는 수정 후 확정하세요.
                  </p>
                  {estimateLabel && (
                    <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                      추정: <strong>{estimateLabel}</strong>
                      {chosenWeek != null ? ` · ${chosenWeek}주차` : ""}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">주차</span>
                      <select
                        className="h-10 w-full rounded-xl border border-input bg-card px-2 text-sm shadow-soft"
                        value={chosenWeek ?? ""}
                        onChange={(e) =>
                          setChosenWeek(
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                          )
                        }
                      >
                        <option value="">미지정</option>
                        {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
                          <option key={w} value={w}>
                            {w}주차
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">교시(슬롯)</span>
                      <select
                        className="h-10 w-full rounded-xl border border-input bg-card px-2 text-sm shadow-soft"
                        value={chosenScheduleId ?? ""}
                        onChange={(e) =>
                          setChosenScheduleId(
                            e.target.value === "" ? null : e.target.value,
                          )
                        }
                      >
                        <option value="">미지정 (ad-hoc)</option>
                        {schedules.map((s) => (
                          <option key={s.id} value={s.id}>
                            {slotLabel(s)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {/* 1차 / 2차 인증 선택. 추정 결과가 2차를 제안하면 자동으로
                      2차가 선택된다 (해당 주차·슬롯에 1차가 끝난 세션이 있음).
                      2차일 때는 pending_session_id로 기존 세션을 reopen. */}
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium">인증 차수</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                          chosenPhase === "check_in"
                            ? "border-primary bg-primary/10 font-medium text-primary"
                            : "border-input bg-card text-muted-foreground hover:bg-accent"
                        }`}
                        onClick={() => setChosenPhase("check_in")}
                      >
                        1차 · 시작 인증
                      </button>
                      <button
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                          chosenPhase === "check_out"
                            ? "border-primary bg-primary/10 font-medium text-primary"
                            : "border-input bg-card text-muted-foreground hover:bg-accent"
                        }`}
                        onClick={() => setChosenPhase("check_out")}
                        disabled={!pendingSessionId}
                        title={
                          pendingSessionId
                            ? "기존 세션의 2차(종료) 인증을 엽니다"
                            : "1차 인증이 완료된 세션이 없어 2차를 열 수 없습니다"
                        }
                      >
                        2차 · 종료 인증
                      </button>
                    </div>
                    {chosenPhase === "check_out" && pendingSessionId && (
                      <p className="text-xs text-muted-foreground">
                        이 주차·교시에 1차 인증을 완료한 세션이 있습니다. 2차
                        인증을 열면 해당 세션이 재오픈됩니다.
                      </p>
                    )}
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => void confirmOpenSession()}
                    disabled={
                      busy ||
                      (chosenPhase === "check_out" && !pendingSessionId)
                    }
                  >
                    <Play className="h-4 w-4" />{" "}
                    {busy
                      ? "여는 중…"
                      : chosenPhase === "check_out"
                        ? "2차 인증 열기"
                        : "확정하고 세션 열기"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- session open ---- */}
        <div className="flex items-end gap-2 border-t pt-4">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">인증 창 (초)</label>
            <Input
              type="number"
              min={10}
              max={600}
              value={windowSeconds}
              onChange={(e) => setWindowSeconds(Number(e.target.value) || 60)}
            />
          </div>
          <Button
            className="flex-1"
            // Disable only while a session is actively open (check_in/check_out).
            // When session is null (never opened / reset) or closed, the button
            // must stay ENABLED so the professor can open a new one.
            disabled={!selected || (session != null && session.phase !== "closed")}
            onClick={() => void onOpen()}
          >
            <Play className="h-4 w-4" />
            {selectedCourse ? `“${selectedCourse.name}” 세션 열기` : "세션 열기"}
          </Button>
        </div>

        {session?.phase !== "closed" && (
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              resetSession();
              resetAttendance();
            }}
          >
            현재 세션 화면 초기화
          </Button>
        )}

        {coursesError && (
          <p className="text-sm text-destructive">{coursesError}</p>
        )}
      </CardContent>
    </Card>
  );
}
