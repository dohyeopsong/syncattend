import { create } from "zustand";
import {
  createCourse as apiCreateCourse,
  enrollStudent as apiEnroll,
  listCourses as apiListCourses,
  listEnrollments as apiListEnrollments,
} from "@/api/client";
import type { Course, Enrollment } from "@/api/types";

interface CoursesState {
  courses: Course[];
  enrollments: Record<string, Enrollment[]>; // by courseId
  loading: boolean;
  error: string | null;
  fetchCourses: () => Promise<void>;
  addCourse: (name: string) => Promise<Course | null>;
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

  addCourse: async (name) => {
    set({ error: null });
    try {
      const course = await apiCreateCourse(name);
      set({ courses: [...get().courses, course] });
      return course;
    } catch (e) {
      set({ error: toMessage(e) });
      return null;
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
