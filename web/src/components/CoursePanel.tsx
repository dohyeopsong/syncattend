import { useEffect, useState, type FormEvent } from "react";
import { useCoursesStore } from "@/store/courses";
import { useSessionStore } from "@/store/session";
import { useAttendanceStore } from "@/store/attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BookOpen, Play, Plus } from "lucide-react";

// Course picker + "open session" trigger. Opening a session starts screen (a).
export function CoursePanel() {
  const courses = useCoursesStore((s) => s.courses);
  const fetchCourses = useCoursesStore((s) => s.fetchCourses);
  const addCourse = useCoursesStore((s) => s.addCourse);
  const coursesError = useCoursesStore((s) => s.error);

  const session = useSessionStore((s) => s.session);
  const openSession = useSessionStore((s) => s.openSession);
  const resetSession = useSessionStore((s) => s.reset);
  const resetAttendance = useAttendanceStore((s) => s.reset);

  const [selected, setSelected] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [windowSeconds, setWindowSeconds] = useState(60);

  useEffect(() => {
    void fetchCourses();
  }, [fetchCourses]);

  useEffect(() => {
    if (!selected && courses.length > 0) setSelected(courses[0].id);
  }, [courses, selected]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const c = await addCourse(newName.trim());
    if (c) {
      setNewName("");
      setSelected(c.id);
    }
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
          <BookOpen className="h-5 w-5" /> 강좌 & 세션
        </CardTitle>
        <CardDescription>
          강좌를 선택하고 인증 창(기본 60초)을 열어 세션을 시작하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">강좌 선택</label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {courses.length === 0 && <option value="">강좌 없음</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-2">
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
            <Play className="h-4 w-4" /> 세션 열기
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

        <form onSubmit={onCreate} className="flex items-end gap-2 border-t pt-4">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">새 강좌 추가</label>
            <Input
              placeholder="예: 소프트웨어공학 (월 9:00)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            <Plus className="h-4 w-4" /> 추가
          </Button>
        </form>

        {coursesError && (
          <p className="text-sm text-destructive">{coursesError}</p>
        )}
      </CardContent>
    </Card>
  );
}
