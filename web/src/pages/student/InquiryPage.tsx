// 문의 tab — attendance inquiry chat (local placeholder).
//
// Mirrors the Flutter InquiryScreen (mobile/lib/features/views/view_screens.dart):
// a simple chat UI. Currently local-only (messages live in component state, no
// backend). The Flutter app has the same placeholder behavior.

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Send, User, Headphones } from "lucide-react";

interface ChatMessage {
  id: number;
  fromMe: boolean;
  text: string;
}

const INITIAL: ChatMessage[] = [
  {
    id: 0,
    fromMe: false,
    text: "안녕하세요! 출결 문의사항을 남겨주시면 담당자가 확인 후 답변드립니다.",
  },
];

export function InquiryPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    const id = messages.length;
    setMessages((m) => [...m, { id, fromMe: true, text }]);
    setDraft("");
    // Auto-acknowledge (placeholder — no backend yet).
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: m.length,
          fromMe: false,
          text: "문의가 접수되었습니다. 추후 답변드리겠습니다.",
        },
      ]);
    }, 600);
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col p-4 pb-24">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">문의</h2>
        <p className="text-xs text-muted-foreground">
          출결 관련 문의사항을 남겨주세요
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border/70 bg-card p-3"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-end gap-2 ${
              m.fromMe ? "flex-row-reverse" : ""
            }`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                m.fromMe
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {m.fromMe ? (
                <User className="h-4 w-4" />
              ) : (
                <Headphones className="h-4 w-4" />
              )}
            </div>
            <div
              className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                m.fromMe
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm bg-muted text-foreground"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <Input
          placeholder="메시지 입력"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          className="flex-1"
        />
        <Button onClick={send} disabled={!draft.trim()} aria-label="전송">
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <MessageCircle className="h-3 w-3" />
        현재 문의 기능은 임시로 운영됩니다.
      </p>
    </div>
  );
}
