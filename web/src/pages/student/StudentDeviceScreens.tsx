// Device registration + re-auth screens (browser side).
//
// Mirrors the Flutter DeviceRegistrationScreen + DeviceReauthScreen (mobile/lib/
// features/auth/device_screens.dart). On web the "secure storage" is
// localStorage (weaker than Keychain/Keystore, but the @wku.ac.kr re-registration
// gate still applies). Shown by StudentHomePage when the device bootstrap finds
// the local UUID unbound or bound to a different account.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStudentDeviceStore } from "@/store/studentDevice";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Smartphone,
  SmartphoneCharging,
  Loader2,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";

const SCHOOL_DOMAIN = "@wku.ac.kr";

export function DeviceRegistrationScreen() {
  const { busy, error, registerDevice } = useStudentDeviceStore();
  const setPhase = useStudentDeviceStore.setState;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md shadow-soft-lg">
        <CardContent className="space-y-5 p-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Smartphone className="h-8 w-8" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">이 기기를 계정에 등록합니다</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              브라우저에 저장된 고유 UUID가 출석 인증에 사용됩니다. 최초 1회
              등록이 필요합니다.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-left text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            className="w-full"
            disabled={busy}
            onClick={() => void registerDevice()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "기기 등록"
            )}
          </Button>

          <button
            className="text-sm text-primary underline-offset-2 hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              // Jump straight to the reauth flow (skips requesting a code until
              // the user enters a valid email). Do not call the API with an
              // empty value; that caused the browser pattern error.
              setPhase({ phase: "needsReauth" });
            }}
          >
            다른 이메일로 기기 재등록하기
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

export function DeviceReauthScreen() {
  const { busy, error, codeSent, requestReauthCode, confirmReauth } =
    useStudentDeviceStore();
  const confirmPairing = useStudentDeviceStore((s) => s.confirmPairing);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const email = useAuthStore((s) => s.email) ?? "";

  const [emailInput, setEmailInput] = useState(email);
  const [code, setCode] = useState("");
  const [pairingCode, setPairingCode] = useState("");

  const schoolEmailPattern = /^[^@\s]+@wku\.ac\.kr$/i;
  const isEmailValid = schoolEmailPattern.test(emailInput.trim());

  function backToLogin() {
    logout();
    navigate("/student/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md shadow-soft-lg">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center justify-between">
            <button
              onClick={backToLogin}
              disabled={busy}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> 로그인으로
            </button>
            <button
              onClick={backToLogin}
              disabled={busy}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              로그아웃
            </button>
          </div>

          <div className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SmartphoneCharging className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-semibold">등록된 계정과 일치하지 않습니다</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              이 기기(UUID)가 다른 계정에 묶여 있습니다. 바인딩하려는 학교
              이메일(@wku.ac.kr)로 인증하면 기존 묶임이 해제되고 인증한 이메일
              계정으로 이 기기가 재등록됩니다.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">학교 이메일 (@wku.ac.kr)</label>
            <Input
              type="email"
              autoComplete="email"
              placeholder="student@wku.ac.kr"
              pattern="^[^@\s]+@wku\.ac\.kr$"
              title={`학교 이메일 형식: student${SCHOOL_DOMAIN}`}
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              disabled={busy}
            />
          </div>

          {codeSent && (
            <div className="space-y-2">
              <label className="text-sm font-medium">인증 코드</label>
              <Input
                type="text"
                placeholder="인증번호"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
              />
            </div>
          )}

          <div className="space-y-2 border-t pt-4">
            <label className="text-sm font-medium">앱 연결 코드</label>
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="앱에서 표시한 6자리 코드"
              value={pairingCode}
              onChange={(e) =>
                setPairingCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              모바일 앱의 메뉴에서 기기 연결 코드를 발급한 뒤 입력하세요.
            </p>
            <Button
              variant="outline"
              className="w-full"
              disabled={busy || pairingCode.length !== 6}
              onClick={() => void confirmPairing(pairingCode)}
            >
              앱 UUID로 웹 연결
            </Button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            className="w-full"
            disabled={busy || !isEmailValid}
            onClick={() =>
              codeSent
                ? void confirmReauth(emailInput, code)
                : void requestReauthCode(emailInput)
            }
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : codeSent ? (
              "코드 확인 & 재바인딩"
            ) : (
              "인증 코드 받기"
            )}
          </Button>

          {codeSent && (
            <button
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={() => void requestReauthCode(emailInput)}
            >
              코드 다시 받기
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
