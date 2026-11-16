// Student courses + attendance store (browser side).
//
// Mirrors the Flutter providers in mobile/lib/core/providers.dart +
// features/courses/course_screens.dart: holds the enrolled-course list
// (timetable source), the browsable catalog (수강신청), and the student's own
// attendance history. Enrollment actions invalidate both lists so the timetable
// and catalog stay in sync after 담기/취소.

import { create } from "zustand";
import {
  enrollSelf as apiEnrollSelf,
  getMyAttendance as apiGetMyAttendance,
  listCourseCatalog as apiListCatalog,
  listMyCourses as apiListMyCourses,
  unenrollSelf as apiUnenrollSelf,
  ApiRequestError,
} from "@/api/client";
import type {
  CourseCatalogItem,
  MyAttendanceItem,
  MyCourseItem,
} from "@/api/types";

interface StudentCoursesState {
  // Enrolled courses (timetable + 내 출결 source).
  myCourses: MyCourseItem[];
  myCoursesStatus: "idle" | "loading" | "error";
  myCoursesError: string | null;

  // Browsable catalog (수강신청 modal source). Each item carries `enrolled`.
  catalog: CourseCatalogItem[];
  catalogStatus: "idle" | "loading" | "error";
  catalogError: string | null;

  // Attendance history (per-session records with course context).
  attendance: MyAttendanceItem[];
  attendanceStatus: "idle" | "loading" | "error";
  attendanceError: string | null;

  // Enrollment action in-flight flag (disables the button for the active course).
  enrollingId: string | null;

  loadMyCourses: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  loadAttendance: () => Promise<void>;
  enroll: (courseId: string) => Promise<boolean>;
  unenroll: (courseId: string) => Promise<boolean>;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export const useStudentCoursesStore = create<StudentCoursesState>(
  (set, get) => ({
    myCourses: [],
    myCoursesStatus: "idle",
    myCoursesError: null,

    catalog: [],
    catalogStatus: "idle",
    catalogError: null,

    attendance: [],
    attendanceStatus: "idle",
    attendanceError: null,

    enrollingId: null,

    loadMyCourses: async () => {
      set({ myCoursesStatus: "loading", myCoursesError: null });
      try {
        const courses = await apiListMyCourses();
        set({ myCourses: courses, myCoursesStatus: "idle" });
      } catch (e) {
        set({ myCoursesStatus: "error", myCoursesError: errMsg(e) });
      }
    },

    loadCatalog: async () => {
      set({ catalogStatus: "loading", catalogError: null });
      try {
        const items = await apiListCatalog();
        set({ catalog: items, catalogStatus: "idle" });
      } catch (e) {
        set({ catalogStatus: "error", catalogError: errMsg(e) });
      }
    },

    loadAttendance: async () => {
      set({ attendanceStatus: "loading", attendanceError: null });
      try {
        const rows = await apiGetMyAttendance();
        set({ attendance: rows, attendanceStatus: "idle" });
      } catch (e) {
        set({ attendanceStatus: "error", attendanceError: errMsg(e) });
      }
    },

    enroll: async (courseId) => {
      set({ enrollingId: courseId });
      try {
        await apiEnrollSelf(courseId);
        // Refresh both lists so the catalog button flips and the timetable
        // picks up the new course immediately.
        await Promise.all([get().loadMyCourses(), get().loadCatalog()]);
        return true;
      } catch (e) {
        // 409 (already enrolled) is benign — just refresh to resync state.
        if (e instanceof ApiRequestError && e.status === 409) {
          await Promise.all([get().loadMyCourses(), get().loadCatalog()]);
          return true;
        }
        set({ myCoursesError: errMsg(e) });
        return false;
      } finally {
        set({ enrollingId: null });
      }
    },

    unenroll: async (courseId) => {
      set({ enrollingId: courseId });
      try {
        await apiUnenrollSelf(courseId);
        await Promise.all([get().loadMyCourses(), get().loadCatalog()]);
        return true;
      } catch (e) {
        set({ myCoursesError: errMsg(e) });
        return false;
      } finally {
        set({ enrollingId: null });
      }
    },
  }),
);
