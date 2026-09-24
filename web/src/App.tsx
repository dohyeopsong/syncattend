import { useEffect } from "react";
import { useHealthStore } from "./store/health";

// Minimal health page. shadcn/ui + real dashboard views are added by owner C.
export function App() {
  const { status, detail, checkHealth } = useHealthStore();

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>Syncattend — Professor Dashboard</h1>
      <p>Web skeleton (owner C). Reads the API contract from <code>../contracts/</code>.</p>
      <section style={{ marginTop: 16 }}>
        <strong>Backend health:</strong>{" "}
        <span data-testid="health-status">{status}</span>
        {detail && <span> — {detail}</span>}
      </section>
      <button style={{ marginTop: 16 }} onClick={() => checkHealth()}>
        Re-check
      </button>
    </main>
  );
}
