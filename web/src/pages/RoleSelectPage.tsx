import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShieldCheck, GraduationCap, ChevronRight } from "lucide-react";

// Public landing page: pick a role before login. The professor dashboard and
// the student browser-auth flow share one web app but use different login
// endpoints (X-Client-Type: web vs student-web), so the entry point routes the
// user to the right login page.
export function RoleSelectPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const accessToken = useAuthStore((s) => s.accessToken);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Syncattend</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          이중 인증 스마트 출결 시스템 — 역할을 선택하세요
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="text-left transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Card className="h-full border-primary/20 shadow-soft">
            <CardHeader>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <CardTitle className="flex items-center justify-between text-lg">
                교수
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
              <CardDescription>
                출결 세션 열기 · QR/초음파 송출 · 실시간 모니터링
              </CardDescription>
            </CardHeader>
          </Card>
        </button>

        <button
          type="button"
          onClick={() => navigate("/student/login")}
          className="text-left transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Card className="h-full border-primary/20 shadow-soft">
            <CardHeader>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <GraduationCap className="h-6 w-6" />
              </div>
              <CardTitle className="flex items-center justify-between text-lg">
                학생
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
              <CardDescription>
                QR 스캔 + 초음파 수신으로 출결 인증 (카메라·마이크 필요)
              </CardDescription>
            </CardHeader>
          </Card>
        </button>
      </div>

      {accessToken && role && (
        <p className="mt-6 text-xs text-muted-foreground">
          {role === "professor"
            ? "교수 계정으로 로그인되어 있습니다."
            : "학생 계정으로 로그인되어 있습니다."}{" "}
          다른 역할로 로그인하려면 위 카드를 선택하세요.
        </p>
      )}
    </div>
  );
}
