import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { CoursePanel } from "@/components/CoursePanel";
import { SessionTokenPanel } from "@/components/SessionTokenPanel";
import { AttendanceTable } from "@/components/AttendanceTable";
import { RealtimeRiskPanel } from "@/components/RealtimeRiskPanel";
import { LogOut, ShieldCheck } from "lucide-react";

export function DashboardPage() {
  const navigate = useNavigate();
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <div className="font-semibold leading-tight">
                Syncattend 교수 대시보드
              </div>
              <div className="text-xs text-muted-foreground">
                이중 인증 스마트 출결 · Opt-out 방식
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {email && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {email}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4" /> 로그아웃
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-2">
        <div className="space-y-6">
          <CoursePanel />
          <SessionTokenPanel />
        </div>
        <div className="space-y-6">
          <RealtimeRiskPanel />
          <AttendanceTable />
        </div>
      </main>
    </div>
  );
}
