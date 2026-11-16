// Student signup page (browser side).
//
// Mirrors the Flutter SignupScreen (mobile/lib/features/auth/signup_screen.dart):
// a sectioned email-verification flow —
//   1. Email (@wku.ac.kr) + inline "발송" button
//   2. 6-digit verification code with a 15-minute countdown
//   3. Profile (name, 학번) + password (validated) + confirm
//   4. Terms checkbox
//   5. Submit (AND-gated on all sections valid)
// On success, alert + return to the login page.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  registerUser as apiRegister,
  sendSignupCode as apiSendCode,
  verifySignupCode as apiVerifyCode,
  ApiRequestError,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  UserPlus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";

const SCHOOL_DOMAIN = "@wku.ac.kr";

export function StudentSignupPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [terms, setTerms] = useState(false);

  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [codeError, setCodeError] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwdConfirmMsg, setPwdConfirmMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isEmailValid =
    email.trim().toLowerCase().endsWith(SCHOOL_DOMAIN) && email.includes("@");

  // 15-minute countdown for the verification code.
  useEffect(() => {
    if (timeLeft <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeLeft]);

  const timerDisplay = `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`;

  async function sendCode() {
    if (!isEmailValid) {
      setEmailMsg({
        ok: false,
        text: `${SCHOOL_DOMAIN} 도메인의 학교 이메일만 사용 가능합니다.`,
      });
      return;
    }
    setIsSending(true);
    setEmailMsg(null);
    try {
      const res = await apiSendCode({ email: email.trim() });
      setShowCode(true);
      setEmailVerified(false);
      setEmailMsg({ ok: true, text: res.message || "인증 코드를 발송했습니다." });
      setTimeLeft(900);
    } catch (e) {
      const msg =
        e instanceof ApiRequestError ? e.message : "서버에 연결할 수 없습니다.";
      setEmailMsg({ ok: false, text: msg });
    } finally {
      setIsSending(false);
    }
  }

  async function verifyCode() {
    if (timeLeft <= 0) {
      setFormError("인증 시간이 만료되었습니다. 인증번호를 다시 발송해주세요.");
      return;
    }
    setIsVerifying(true);
    try {
      const res = await apiVerifyCode({ email: email.trim(), code: code.trim() });
      if (timerRef.current) clearInterval(timerRef.current);
      setEmailVerified(true);
      setShowCode(false);
      setEmailMsg({ ok: true, text: res.message || "이메일 인증이 완료되었습니다." });
    } catch {
      setCodeError(true);
      setTimeout(() => setCodeError(false), 1000);
    } finally {
      setIsVerifying(false);
    }
  }

  function validatePassword(pwd: string) {
    const special = /[!@#$%^&*(),.?":{}|<>]/.test(pwd);
    const repeat = /(.)\1{2,}/.test(pwd);
    const sequential = hasSequential(pwd);
    if (pwd.length < 8) {
      setPwdMsg({ ok: false, text: "비밀번호는 8자리 이상이어야 합니다." });
    } else if (!special) {
      setPwdMsg({ ok: false, text: "특수문자를 1개 이상 포함해야 합니다." });
    } else if (repeat) {
      setPwdMsg({ ok: false, text: "동일한 문자/숫자를 3번 이상 연속 사용할 수 없습니다." });
    } else if (sequential) {
      setPwdMsg({ ok: false, text: "연속되는 문자/숫자(예: 123, abc)를 사용할 수 없습니다." });
    } else {
      setPwdMsg({ ok: true, text: "사용 가능한 비밀번호입니다." });
    }
    checkMatch(pwd, passwordConfirm);
  }

  function checkMatch(pwd: string, confirm: string) {
    if (!confirm) {
      setPwdConfirmMsg(null);
      return;
    }
    setPwdConfirmMsg(
      pwd !== confirm
        ? { ok: false, text: "비밀번호가 일치하지 않습니다." }
        : { ok: true, text: "비밀번호가 일치합니다." },
    );
  }

  const isPasswordValid = pwdMsg?.ok ?? false;
  const canSubmit =
    emailVerified &&
    isPasswordValid &&
    password === passwordConfirm &&
    terms &&
    name.trim().length > 0 &&
    studentId.trim().length > 0;

  async function submit() {
    setFormError(null);
    if (!emailVerified) return setFormError("이메일 인증을 먼저 완료해주세요.");
    if (!name.trim()) return setFormError("이름을 입력해주세요.");
    if (!studentId.trim()) return setFormError("학번을 입력해주세요.");
    if (!isPasswordValid) return setFormError("비밀번호 양식을 올바르게 작성해주세요.");
    if (password !== passwordConfirm) return setFormError("비밀번호 재입력이 일치하지 않습니다.");
    if (!terms) return setFormError("약관에 동의해주세요.");

    setIsRegistering(true);
    try {
      await apiRegister({
        email: email.trim(),
        password,
        role: "student",
        name: name.trim(),
        student_id: studentId.trim(),
      });
      alert("회원가입이 완료되었습니다. 로그인해주세요.");
      navigate("/student/login", { replace: true });
    } catch (e) {
      const msg =
        e instanceof ApiRequestError ? e.message : "서버에 연결할 수 없습니다.";
      setFormError(msg);
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
      <Card className="w-full max-w-md shadow-soft-lg">
        <CardContent className="space-y-5 p-6">
          {/* Branding */}
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
              <UserPlus className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold">회원가입</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              스마트 출결 · 학생 계정 만들기
            </p>
          </div>

          {/* Section 1: Email */}
          <SectionLabel label="아이디 (학교 이메일)" done={emailVerified} />
          <p className="-mt-3 text-xs text-muted-foreground">
            {SCHOOL_DOMAIN} 형식의 이메일만 사용 가능합니다.
          </p>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="email"
              autoComplete="email"
              placeholder="student@wku.ac.kr"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailMsg(null);
              }}
              disabled={emailVerified || isSending}
              className="flex-1"
            />
            <Button
              onClick={sendCode}
              disabled={emailVerified || isSending || !email}
              variant={isEmailValid || !email ? "default" : "destructive"}
              className="shrink-0"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : emailVerified ? "완료" : "발송"}
            </Button>
          </div>
          {emailMsg && <FieldMessage {...emailMsg} />}

          {/* Section 2: Verification code */}
          {(showCode || emailVerified) && (
            <>
              <SectionLabel label="인증번호 6자리" done={emailVerified} />
              <div
                className={`flex gap-2 ${codeError ? "animate-[shake_0.4s_ease-in-out]" : ""}`}
              >
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="인증번호 입력"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={emailVerified || isVerifying}
                  className={`flex-1 ${codeError ? "border-destructive" : ""}`}
                />
                {!emailVerified && (
                  <span className="flex items-center px-1 text-sm font-bold text-destructive">
                    {timerDisplay}
                  </span>
                )}
                <Button
                  onClick={verifyCode}
                  disabled={emailVerified || isVerifying}
                  variant={codeError ? "destructive" : "default"}
                  className="shrink-0"
                >
                  {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : emailVerified ? "완료" : "확인"}
                </Button>
              </div>
            </>
          )}

          <div className="border-t" />

          {/* Section 3: Profile */}
          <SectionLabel label="이름" />
          <Input
            placeholder="홍길동"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <SectionLabel label="학번" />
          <Input
            inputMode="numeric"
            maxLength={32}
            placeholder="2026123456"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          />

          <SectionLabel label="비밀번호" />
          <p className="-mt-3 text-xs text-muted-foreground">
            8자리 이상, 특수문자 포함 (연속/반복 문자 불가)
          </p>
          <Input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              validatePassword(e.target.value);
            }}
          />
          {pwdMsg && <FieldMessage {...pwdMsg} />}

          <SectionLabel label="비밀번호 재입력" />
          <Input
            type="password"
            placeholder="password"
            value={passwordConfirm}
            onChange={(e) => {
              setPasswordConfirm(e.target.value);
              checkMatch(password, e.target.value);
            }}
          />
          {pwdConfirmMsg && <FieldMessage {...pwdConfirmMsg} />}

          {/* Section 4: Terms */}
          <label className="flex cursor-pointer items-center gap-2.5 py-1">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <span className={`text-sm ${terms ? "font-medium" : "text-muted-foreground"}`}>
              이용약관 및 개인정보처리방침에 동의합니다
            </span>
          </label>

          {formError && <FieldMessage ok={false} text={formError} />}

          {/* Section 5: Submit */}
          <Button
            className="w-full"
            disabled={isRegistering || !canSubmit}
            onClick={submit}
          >
            {isRegistering ? <Loader2 className="h-4 w-4 animate-spin" /> : "회원가입 완료"}
          </Button>

          <button
            onClick={() => navigate("/student/login")}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            이미 계정이 있으신가요? 로그인
          </button>

          <button
            onClick={() => navigate("/student/login")}
            className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> 로그인으로 돌아가기
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionLabel({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      {done && (
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" /> 완료
        </span>
      )}
    </div>
  );
}

function FieldMessage({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p
      className={`flex items-center gap-1.5 text-xs ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
    >
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5" />
      )}
      {text}
    </p>
  );
}

function hasSequential(str: string): boolean {
  for (let i = 0; i < str.length - 2; i++) {
    const c1 = str.charCodeAt(i);
    const c2 = str.charCodeAt(i + 1);
    const c3 = str.charCodeAt(i + 2);
    if ((c1 + 1 === c2 && c2 + 1 === c3) || (c1 - 1 === c2 && c2 - 1 === c3)) {
      return true;
    }
  }
  return false;
}
