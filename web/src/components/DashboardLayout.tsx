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
  Menu,
  X,
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
  // Mobile-only nav menu (sidebar is hidden below md).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function goTo(id: string) {
    setActive(id);
    setMobileNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Shared nav button. `aria-current="page"` marks the active section for AT,
  // and a visible focus-visible ring keeps keyboard navigation obvious.
  function NavButton({ id, label, Icon }: NavItem) {
    const isActive = active === id;
    return (
      <button
        key={id}
        onClick={() => goTo(id)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar (md and up) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          <div className="text-sm font-semibold leading-tight">
            Syncattend
            <div className="text-xs font-normal text-muted-foreground">
              교수 대시보드
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3" aria-label="주요 메뉴">
          {NAV.map((item) => (
            <NavButton key={item.id} {...item} />
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          이중 인증 · Opt-out 출결
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            {/* Mobile menu toggle (hidden at md+, where the sidebar is shown) */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={mobileNavOpen ? "메뉴 닫기" : "메뉴 열기"}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileNavOpen((o) => !o)}
            >
              {mobileNavOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </Button>
            <div className="flex items-center gap-2 md:hidden">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold">Syncattend</span>
            </div>
          </div>
          <div className="hidden text-sm font-medium md:block">교수 대시보드</div>
          <div className="flex items-center gap-3">
            {email && (
              <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground sm:inline">
                {email}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4" aria-hidden="true" /> 로그아웃
            </Button>
          </div>
        </header>

        {/* Mobile nav dropdown (below md only) */}
        {mobileNavOpen && (
          <nav
            id="mobile-nav"
            aria-label="주요 메뉴"
            className="space-y-1 border-b bg-card p-3 md:hidden"
          >
            {NAV.map((item) => (
              <NavButton key={item.id} {...item} />
            ))}
          </nav>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
