import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { RoleSelectPage } from "@/pages/RoleSelectPage";
import { LoginPage } from "@/pages/LoginPage";
import { StudentLoginPage } from "@/pages/StudentLoginPage";
import { StudentSignupPage } from "@/pages/student/StudentSignupPage";
import { StudentHomePage } from "@/pages/student/StudentHomePage";
import { StudentVerifyPage } from "@/pages/StudentVerifyPage";
import { DashboardPage } from "@/pages/DashboardPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  // No token → back to the role-select landing page (the user picks professor
  // or student there, which routes to the right login page).
  if (!accessToken) return <Navigate to="/" replace />;
  return children;
}

/** Professor-only guard: a student session must NOT reach the dashboard. */
function RequireProfessor({ children }: { children: JSX.Element }) {
  const role = useAuthStore((s) => s.role);
  if (role !== "professor") return <Navigate to="/student" replace />;
  return children;
}

/** Student-only guard: a professor session must NOT reach the student pages. */
function RequireStudent({ children }: { children: JSX.Element }) {
  const role = useAuthStore((s) => s.role);
  if (role !== "student") return <Navigate to="/dashboard" replace />;
  return children;
}

export function App() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <Routes>
      {/* Public landing: pick professor or student. */}
      <Route path="/" element={<RoleSelectPage />} />
      {/* Login pages (each sends the matching X-Client-Type). */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/student/login" element={<StudentLoginPage />} />
      <Route path="/student/signup" element={<StudentSignupPage />} />
      {/* Authenticated areas. */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <RequireProfessor>
              <DashboardPage />
            </RequireProfessor>
          </RequireAuth>
        }
      />
      <Route
        path="/student"
        element={
          <RequireAuth>
            <RequireStudent>
              <StudentHomePage />
            </RequireStudent>
          </RequireAuth>
        }
      />
      <Route
        path="/student/verify"
        element={
          <RequireAuth>
            <RequireStudent>
              <StudentVerifyPage />
            </RequireStudent>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
