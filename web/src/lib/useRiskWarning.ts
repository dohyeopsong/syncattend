// Risk-warning SSE hook (browser side).
//
// Mirrors the Flutter riskWarningProvider (mobile/lib/features/risk/
// risk_warning.dart): subscribes to GET /sse/students/{id} and surfaces the
// latest RiskWarning. Uses fetch + a streaming reader rather than EventSource
// so we can attach the bearer token as a query param (EventSource cannot set
// headers, and our stream accepts ?access_token=). Returns null while no
// warning has arrived or the stream is connecting.

import { useEffect, useState } from "react";
import { getAccessToken, parseRiskFrame, sseStudentUrl } from "@/api/client";
import type { RiskWarning } from "@/api/types";

export function useRiskWarning(studentId: string | null): RiskWarning | null {
  const [warning, setWarning] = useState<RiskWarning | null>(null);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    let decoder: TextDecoder;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let buffer = "";

    // Reconnect with a short backoff so a dropped SSE connection (e.g. Render
    // idle spin-down) recovers without a page reload.
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    async function connect() {
      if (cancelled) return;
      const url = sseStudentUrl(studentId!);
      try {
        const res = await fetch(url, {
          headers: { Accept: "text/event-stream" },
        });
        if (!res.body) return;
        reader = res.body.getReader();
        decoder = new TextDecoder();
        attempt = 0;
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by blank lines. Process each complete frame.
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = frame
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            const payload = dataLine.slice(5).trim();
            const parsed = parseRiskFrame(payload);
            if (parsed && !cancelled) setWarning(parsed);
          }
        }
      } catch {
        // network error / stream closed — schedule a reconnect.
      } finally {
        try {
          reader?.cancel();
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) {
        attempt += 1;
        const delay = Math.min(1000 * attempt, 8000);
        reconnectTimer = setTimeout(connect, delay);
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        reader?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [studentId]);

  // Silence the unused-import lint for getAccessToken (kept for future header
  // based fetch paths); the token is already embedded in sseStudentUrl.
  void getAccessToken;

  return warning;
}
