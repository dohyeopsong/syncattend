import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCards } from "@/components/StatCards";
import { CoursePanel } from "@/components/CoursePanel";
import { SessionTokenPanel } from "@/components/SessionTokenPanel";
import { AttendanceTable } from "@/components/AttendanceTable";
import { RealtimeRiskPanel } from "@/components/RealtimeRiskPanel";

export function DashboardPage() {
  return (
    <DashboardLayout>
      {/* Overview: stat cards */}
      <section id="overview" className="scroll-mt-20 space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">출결 현황</h1>
        <StatCards />
      </section>

      {/* Emit + course/session controls */}
      <section id="emit" className="scroll-mt-20 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CoursePanel />
        <SessionTokenPanel />
      </section>

      {/* Realtime monitor */}
      <section id="realtime" className="scroll-mt-20">
        <RealtimeRiskPanel />
      </section>

      {/* Attendance review + delta close */}
      <section id="attendance" className="scroll-mt-20">
        <AttendanceTable />
      </section>
    </DashboardLayout>
  );
}
