import { create } from "zustand";
import {
  createCourse as apiCreateCourse,
  deleteCourse as apiDeleteCourse,
  enrollStudent as apiEnroll,
  listCourseCatalog as apiListCatalog,
  listCourses as apiListCourses,
  listEnrollments as apiListEnrollments,
  updateCourse as apiUpdateCourse,
} from "@/api/client";
import type {
  Course,
  CourseCatalogItem,
  CreateCourseRequest,
  Enrollment,
  UpdateCourseRequest,
} from "@/api/types";

// Which field the professor is searching by. "all" keeps the original
// behavior (name / professor / code together); the others narrow to one field
// so the autocomplete only matches the chosen column.
export type SearchField = "all" | "name" | "professor_name" | "code";

// Client-side filter. The backend `q` returns a broad OR match across
// name/professor/code; we further narrow to the selected field here so no
// contract/backend change is needed.
function matchesQuery(
  c: CourseCatalogItem,
  q: string,
  field: SearchField,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const fields: (string | null | undefined)[] =
    field === "all"
      ? [c.name, c.code, c.professor_name, c.department]
      : field === "name"
        ? [c.name]
        : field === "professor_name"
          ? [c.professor_name]
          : [c.code];
  return fields
    .filter((v): v is string => !!v)
    .some((v) => v.toLowerCase().includes(needle));
}

interface CoursesState {
  courses: Course[];
  enrollments: Record<string, Enrollment[]>; // by courseId
  loading: boolean;
  error: string | null;
  catalog: CourseCatalogItem[]; // latest search results
  catalogLoading: boolean;
  fetchCourses: () => Promise<void>;
  searchCatalog: (q: string, field?: SearchField) => Promise<void>;
  clearCatalog: () => void;
  addCourse: (payload: CreateCourseRequest) => Promise<Course | null>;
  updateCourse: (
    courseId: string,
    payload: UpdateCourseRequest,
  ) => Promise<Course | null>;
  deleteCourse: (courseId: string) => Promise<boolean>;
  fetchEnrollments: (courseId: string) => Promise<void>;
  enroll: (courseId: string, studentId: string) => Promise<boolean>;
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useCoursesStore = create<CoursesState>((set, get) => ({
  courses: [],
  enrollments: {},
  loading: false,
  error: null,
  catalog: [],
  catalogLoading: false,

  fetchCourses: async () => {
    set({ loading: true, error: null });
    try {
      const courses = await apiListCourses();
      set({ courses, loading: false });
    } catch (e) {
      set({ loading: false, error: toMessage(e) });
    }
  },

  // Debounced by the caller. Fetches a broad match from the backend (?q=),
  // then narrows client-side to the selected `field` (name / professor / code
  // / all). A blank query clears results. No backend/contract change needed.
  searchCatalog: async (q, field = "all") => {
    if (!q.trim()) {
      set({ catalog: [], catalogLoading: false });
      return;
    }
    set({ catalogLoading: true });
    try {
      const items = await apiListCatalog(q);
      const filtered = items.filter((c) => matchesQuery(c, q, field));
      set({ catalog: filtered, catalogLoading: false });
    } catch (e) {
      set({ catalogLoading: false, error: toMessage(e) });
    }
  },

  clearCatalog: () => set({ catalog: [] }),

  addCourse: async (payload) => {
    set({ error: null });
    try {
      const course = await apiCreateCourse(payload);
      set({ courses: [...get().courses, course] });
      return course;
    } catch (e) {
      set({ error: toMessage(e) });
      return null;
    }
  },

  updateCourse: async (courseId, payload) => {
    set({ error: null });
    try {
      const updated = await apiUpdateCourse(courseId, payload);
      set({
        courses: get().courses.map((c) => (c.id === courseId ? updated : c)),
      });
      return updated;
    } catch (e) {
      set({ error: toMessage(e) });
      return null;
    }
  },

  deleteCourse: async (courseId) => {
    set({ error: null });
    try {
      await apiDeleteCourse(courseId);
      const { [courseId]: _removed, ...restEnrollments } = get().enrollments;
      set({
        courses: get().courses.filter((c) => c.id !== courseId),
        enrollments: restEnrollments,
      });
      return true;
    } catch (e) {
      set({ error: toMessage(e) });
      return false;
    }
  },

  fetchEnrollments: async (courseId) => {
    set({ error: null });
    try {
      const list = await apiListEnrollments(courseId);
      set({ enrollments: { ...get().enrollments, [courseId]: list } });
    } catch (e) {
      set({ error: toMessage(e) });
    }
  },

  enroll: async (courseId, studentId) => {
    set({ error: null });
    try {
      const enrollment = await apiEnroll(courseId, studentId);
      const current = get().enrollments[courseId] ?? [];
      set({
        enrollments: {
          ...get().enrollments,
          [courseId]: [...current, enrollment],
        },
      });
      return true;
    } catch (e) {
      set({ error: toMessage(e) });
      return false;
    }
  },
}));
