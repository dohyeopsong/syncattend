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
  CreateCourseRequest,
  DayOfWeek,
  UpdateCourseRequest,
} from "@/api/types";
import { BookOpen, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";

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

// "09:00~12:00" spanning start..end periods (inclusive).
function periodRangeTime(start: number, end: number): string {
  const s = periodStartHour(start);
  const e = periodStartHour(end) + 1;
  return `${pad2(s)}:00~${pad2(e)}:00`;
}

// Small debounce hook — returns the value after it has been stable for `ms`.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Editable schedule fields shared by the add + edit forms (all strings for
// controlled inputs; converted to typed payload on submit).
interface CourseForm {
  name: string;
  code: string;
  department: string;
  professor_name: string;
  day_of_week: string; // "" | "1".."7"
  start_period: string;
  end_period: string;
  location: string;
  credits: string;
}

const EMPTY_FORM: CourseForm = {
  name: "",
  code: "",
  department: "",
  professor_name: "",
  day_of_week: "",
  start_period: "",
  end_period: "",
  location: "",
  credits: "",
};

function courseToForm(c: Course): CourseForm {
  return {
    name: c.name ?? "",
    code: c.code ?? "",
    department: c.department ?? "",
    professor_name: c.professor_name ?? "",
    day_of_week: c.day_of_week != null ? String(c.day_of_week) : "",
    start_period: c.start_period != null ? String(c.start_period) : "",
    end_period: c.end_period != null ? String(c.end_period) : "",
    location: c.location ?? "",
    credits: c.credits != null ? String(c.credits) : "",
  };
}

// Empty string → null; numeric strings → number. Keeps optional fields sparse.
function formToPayload(f: CourseForm): CreateCourseRequest {
  const str = (v: string) => (v.trim() === "" ? null : v.trim());
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const day = f.day_of_week.trim() === "" ? null : (Number(f.day_of_week) as DayOfWeek);
  return {
    name: f.name.trim(),
    code: str(f.code),
    department: str(f.department),
    professor_name: str(f.professor_name),
    day_of_week: day,
    start_period: num(f.start_period),
    end_period: num(f.end_period),
    location: str(f.location),
    credits: num(f.credits),
  };
}

// Fill the add form from a selected catalog item (day/period stay editable).
function catalogItemToForm(item: CourseCatalogItem): CourseForm {
  return {
    name: item.name ?? "",
    code: item.code ?? "",
    department: item.department ?? "",
    professor_name: item.professor_name ?? "",
    day_of_week: item.day_of_week != null ? String(item.day_of_week) : "",
    start_period: item.start_period != null ? String(item.start_period) : "",
    end_period: item.end_period != null ? String(item.end_period) : "",
    location: item.location ?? "",
    credits: item.credits != null ? String(item.credits) : "",
  };
}

// Front-end validation: if both periods set, start must be <= end.
function periodError(f: CourseForm): string | null {
  const s = f.start_period.trim();
  const e = f.end_period.trim();
  if (s === "" || e === "") return null;
  if (Number(s) > Number(e)) return "시작 교시는 종료 교시보다 앞서야 합니다.";
  return null;
}

function scheduleLabel(c: Course): string {
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
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          요일
        </label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={form.day_of_week}
          onChange={(e) => upd({ day_of_week: e.target.value })}
        >
          <option value="">미지정</option>
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {DAY_LABELS[d]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          시작 교시
        </label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={form.start_period}
          onChange={(e) => upd({ start_period: e.target.value })}
        >
          <option value="">미지정</option>
          {PERIOD_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          종료 교시
        </label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={form.end_period}
          onChange={(e) => upd({ end_period: e.target.value })}
        >
          <option value="">미지정</option>
          {PERIOD_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}
            </option>
          ))}
        </select>
      </div>
      {form.start_period && form.end_period && !periodError(form) && (
        <p className="col-span-2 text-[11px] text-muted-foreground">
          수업 시간:{" "}
          {periodRangeTime(Number(form.start_period), Number(form.end_period))}
        </p>
      )}
      {periodError(form) && (
        <p className="col-span-2 text-[11px] text-destructive">
          {periodError(form)}
        </p>
      )}
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

  const [query, setQuery] = useState("");
  const [field, setField] = useState<SearchField>("all");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query, 300);
  const boxRef = useRef<HTMLDivElement>(null);

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
          className="h-10 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
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
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-background shadow-md"
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
          {catalog.map((item) => (
            <li key={item.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent"
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
                </span>
                <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {item.professor_name && <span>{item.professor_name}</span>}
                  {item.department && <span>{item.department}</span>}
                </span>
              </button>
            </li>
          ))}
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

  const session = useSessionStore((s) => s.session);
  const openSession = useSessionStore((s) => s.openSession);
  const resetSession = useSessionStore((s) => s.reset);
  const resetAttendance = useAttendanceStore((s) => s.reset);

  const [selected, setSelected] = useState<string>("");
  const [windowSeconds, setWindowSeconds] = useState(60);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<CourseForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CourseForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === selected),
    [courses, selected],
  );

  useEffect(() => {
    void fetchCourses();
  }, [fetchCourses]);

  useEffect(() => {
    if (!selected && courses.length > 0) setSelected(courses[0].id);
  }, [courses, selected]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim()) return;
    if (periodError(addForm)) return; // start<=end guard
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
    resetAttendance();
    await openSession(selected, windowSeconds);
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
                setShowAdd((v) => !v);
                setAddForm(EMPTY_FORM);
              }}
            >
              {showAdd ? (
                <>
                  <X className="h-4 w-4" /> 닫기
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> 강좌 추가
                </>
              )}
            </Button>
          </div>

          {courses.length === 0 && !showAdd && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              등록된 강좌가 없습니다. “강좌 추가”로 시작하세요.
            </p>
          )}

          <ul className="divide-y rounded-md border">
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
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="flex-1 text-left"
                        onClick={() => setSelected(c.id)}
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
                          className="text-destructive hover:text-destructive"
                          onClick={() => void onDelete(c)}
                          disabled={busy}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* ---- add form ---- */}
        {showAdd && (
          <form
            onSubmit={onCreate}
            className="space-y-3 rounded-md border border-dashed p-3"
          >
            <p className="text-sm font-medium">새 강좌 추가</p>
            {/* Autocomplete: pick from the catalog to auto-fill, then adjust
                요일/교시. If no match, fill the fields below manually. */}
            <CatalogSearch
              onSelect={(item) =>
                setAddForm((prev) => ({
                  ...catalogItemToForm(item),
                  // keep whatever the professor may have already set for day/period
                  day_of_week: prev.day_of_week || (item.day_of_week != null ? String(item.day_of_week) : ""),
                  start_period: prev.start_period || (item.start_period != null ? String(item.start_period) : ""),
                  end_period: prev.end_period || (item.end_period != null ? String(item.end_period) : ""),
                }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              검색 결과가 없으면 아래에서 직접 입력하세요.
            </p>
            <CourseFields form={addForm} setForm={setAddForm} />
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !addForm.name.trim() || !!periodError(addForm)}
              >
                <Plus className="h-4 w-4" /> 추가
              </Button>
            </div>
          </form>
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
            disabled={!selected || session?.status === "open"}
            onClick={() => void onOpen()}
          >
            <Play className="h-4 w-4" />
            {selectedCourse ? `“${selectedCourse.name}” 세션 열기` : "세션 열기"}
          </Button>
        </div>

        {session?.status === "open" && (
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
