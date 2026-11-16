import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GraduationCap, Loader2 } from "lucide-react";

// Student browser login. Mirrors the professor LoginPage but uses
// loginStudent (X-Client-Type: student-web) and routes to /student on success.
// This is the entry point for a student authenticating from a browser (e.g.
// iPhone Safari) without installing the Flutter app.
export function StudentLoginPage() {
  const navigate = useNavigate();
  const loginStudent = useAuthStore((s) => s.loginStudent);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isLoading = status === "loading";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await loginStudent(email, password);
    if (ok) navigate("/student", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-soft-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-soft">
            <GraduationCap className="h-8 w-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-xl">학생 출결 인증</CardTitle>
          <CardDescription>
            이중 인증 스마트 출결 — 학생 웹 로그인
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                이메일
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="student@wku.ac.kr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                비밀번호
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  로그인 중…
                </>
              ) : (
                "로그인"
              )}
            </Button>
            <button
              type="button"
              onClick={() => navigate("/student/signup")}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              계정이 없으신가요? 회원가입
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
