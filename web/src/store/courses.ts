import { create } from "zustand";
import {
  createCourse as apiCreateCourse,
  deleteCourse as apiDeleteCourse,
  enrollStudent as apiEnroll,
  listCourses as apiListCourses,
  listEnrollments as apiListEnrollments,
  updateCourse as apiUpdateCourse,
} from "@/api/client";
import type {
  Course,
  CreateCourseRequest,
  Enrollment,
  UpdateCourseRequest,
} from "@/api/types";

interface CoursesState {
  courses: Course[];
  enrollments: Record<string, Enrollment[]>; // by courseId
  loading: boolean;
  error: string | null;
  fetchCourses: () => Promise<void>;
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

  fetchCourses: async () => {
    set({ loading: true, error: null });
    try {
      const courses = await apiListCourses();
      set({ courses, loading: false });
    } catch (e) {
      set({ loading: false, error: toMessage(e) });
    }
  },

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
