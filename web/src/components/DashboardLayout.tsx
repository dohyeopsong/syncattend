import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  LayoutDashboard,
  BookOpen,
  FlaskConical,
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
  { id: "courses", label: "강좌", Icon: BookOpen },
  { id: "simulation", label: "시뮬레이션", Icon: FlaskConical },
];

// App shell: left sidebar (nav) + top bar + content (design guide §3).
export function DashboardLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const [active, setActive] = useState("courses");
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
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          isActive
            ? "bg-primary/10 text-primary shadow-soft"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
            isActive
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        </span>
        {label}
      </button>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar (md and up) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border/60 bg-card md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-soft">
            <ShieldCheck className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
          </div>
          <div className="text-sm font-bold leading-tight">
            Syncattend
            <div className="text-xs font-normal text-muted-foreground">
              교수 대시보드
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1.5 p-3" aria-label="주요 메뉴">
          {NAV.map((item) => (
            <NavButton key={item.id} {...item} />
          ))}
        </nav>
        <div className="m-3 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
          이중 인증 · Opt-out 출결
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-card/80 px-4 py-3 backdrop-blur-md sm:px-6">
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <ShieldCheck className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
              </div>
              <span className="text-sm font-bold">Syncattend</span>
            </div>
          </div>
          <div className="hidden text-sm font-semibold md:block">교수 대시보드</div>
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
            className="space-y-1.5 border-b border-border/60 bg-card p-3 md:hidden"
          >
            {NAV.map((item) => (
              <NavButton key={item.id} {...item} />
            ))}
          </nav>
        )}

        {/* Session-expired banner: the access token expired and refresh also
            failed (refresh token revoked/expired). The user must re-login. */}
        {sessionExpired && (
          <div
            role="alert"
            className="flex flex-col gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <div className="flex items-center gap-2 text-amber-800">
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                로그인이 만료되었습니다. 다시 로그인해 주세요.
              </span>
            </div>
            <Button
              size="sm"
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
            >
              다시 로그인
            </Button>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
