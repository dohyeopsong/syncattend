import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  LayoutDashboard,
  Radio,
  ClipboardCheck,
  Activity,
  LogOut,
} from "lucide-react";

interface NavItem {
  id: string;
  label: string;
  Icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { id: "overview", label: "대시보드", Icon: LayoutDashboard },
  { id: "emit", label: "토큰 송출", Icon: Radio },
  { id: "attendance", label: "출결 검토", Icon: ClipboardCheck },
  { id: "realtime", label: "실시간", Icon: Activity },
];

// App shell: left sidebar (nav) + top bar + content (design guide §3).
export function DashboardLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);
  const [active, setActive] = useState("overview");

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function goTo(id: string) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <div className="text-sm font-semibold leading-tight">
            Syncattend
            <div className="text-xs font-normal text-muted-foreground">
              교수 대시보드
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => goTo(id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          이중 인증 · Opt-out 출결
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2 md:hidden">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">Syncattend</span>
          </div>
          <div className="hidden text-sm font-medium md:block">교수 대시보드</div>
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
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
