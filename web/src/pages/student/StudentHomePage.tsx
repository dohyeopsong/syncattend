// Student home shell (browser side).
//
// Mirrors the Flutter HomeShell (mobile/lib/features/home/home_shell.dart):
// a 3-tab bottom navigation (내 출결 / 시간표 / 문의) with a persistent SSE
// risk-warning banner below the app bar and a floating "출석 인증" button that
// opens the verify page. On mount it bootstraps the device binding — if the
// local UUID is unbound or bound to a different account, the matching device
// screen is shown instead of the shell.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStudentDeviceStore } from "@/store/studentDevice";
import { useAuthStore } from "@/store/auth";
import { getMe } from "@/api/client";
import { useRiskWarning } from "@/lib/useRiskWarning";
import { RiskWarningBanner } from "@/components/student/RiskWarningBanner";
import { MyAttendancePage } from "./MyAttendancePage";
import { TimetablePage } from "./TimetablePage";
import { InquiryPage } from "./InquiryPage";
import {
  DeviceRegistrationScreen,
  DeviceReauthScreen,
} from "./StudentDeviceScreens";
import { Button } from "@/components/ui/button";
import {
  ClipboardList,
  CalendarDays,
  MessageCircle,
  QrCode,
  LogOut,
  GraduationCap,
} from "lucide-react";
import type { UserOut } from "@/api/types";

type Tab = "attendance" | "timetable" | "inquiry";

const TABS: { key: Tab; label: string; Icon: typeof ClipboardList }[] = [
  { key: "attendance", label: "내 출결", Icon: ClipboardList },
  { key: "timetable", label: "시간표", Icon: CalendarDays },
  { key: "inquiry", label: "문의", Icon: MessageCircle },
];

export function StudentHomePage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const email = useAuthStore((s) => s.email);

  const { phase, bootstrap } = useStudentDeviceStore();
  const [me, setMe] = useState<UserOut | null>(null);
  const [tab, setTab] = useState<Tab>("attendance");

  // Resolve the student profile (for the SSE subscription + header) and
  // bootstrap the device binding in parallel.
  useEffect(() => {
    void bootstrap();
    getMe()
      .then(setMe)
      .catch(() => {
        /* token may be invalid — the auth guard will handle re-login */
      });
  }, [bootstrap]);

  const warning = useRiskWarning(phase === "ready" ? me?.id ?? null : null);

  // Device bootstrap gates the shell.
  if (phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <GraduationCap className="h-8 w-8 animate-pulse text-primary" />
          <p className="text-sm">불러오는 중…</p>
        </div>
      </div>
    );
  }
  if (phase === "needsDeviceRegistration") return <DeviceRegistrationScreen />;
  if (phase === "needsReauth") return <DeviceReauthScreen />;

  function onLogout() {
    if (!confirm("로그아웃하시겠습니까?")) return;
    logout();
    navigate("/student/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      {/* App bar */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {tab === "timetable" ? "내 시간표" : tab === "inquiry" ? "문의" : "내 출결"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {me?.name ?? email ?? "학생"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onLogout} aria-label="로그아웃">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        {/* Risk warning banner (SSE) */}
        <div className="px-4 pb-2">
          <RiskWarningBanner warning={warning} />
        </div>
      </header>

      {/* Tab body */}
      <main className="flex-1">
        {tab === "attendance" && <MyAttendancePage />}
        {tab === "timetable" && <TimetablePage />}
        {tab === "inquiry" && <InquiryPage />}
      </main>

      {/* Floating "출석 인증" button — only on the 내 출결 tab */}
      {tab === "attendance" && (
        <button
          onClick={() => navigate("/student/verify")}
          className="fixed bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-soft-lg transition-transform hover:scale-105"
        >
          <QrCode className="h-5 w-5" />
          출석 인증
        </button>
      )}

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-md">
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
