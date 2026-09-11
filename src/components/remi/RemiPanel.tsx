import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { sendRemiMessage } from "../../api/remiApi";
import { ChatBubble, RemiAvatar, type MessageItem, uid } from "./RemiShared";

const QUICK_PROMPTS = [
  "Summarize my spending this month",
  "How's my budget looking?",
  "Am I on track for my goals?",
  "What's my cash flow forecast?",
  "Show me my top expenses",
];

function AutoTextarea({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder="Ask Remi…"
      className="remi-panel-textarea"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}

export function RemiPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMsg: MessageItem = { id: uid(), role: "user", content: trimmed };
      const loadingId = uid();
      const loadingMsg: MessageItem = { id: loadingId, role: "assistant", content: "", loading: true };

      setMessages((prev) => [...prev, userMsg, loadingMsg]);
      setInput("");
      setSending(true);

      try {
        const reply = await sendRemiMessage(trimmed, conversationId);
        if (reply.conversationId) setConversationId(reply.conversationId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId
              ? { id: loadingId, role: "assistant" as const, content: reply.reply ?? "" }
              : m,
          ),
        );
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId
              ? { id: loadingId, role: "assistant" as const, content: "Something went wrong. Please try again." }
              : m,
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending],
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="remi-panel">
      {/* Header */}
      <div className="remi-panel-header">
        <div className="flex items-center gap-2.5">
          <RemiAvatar size="md" />
          <div className="leading-none">
            <p className="text-[14px] font-bold text-[var(--text-primary)]">Remi</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">AI Advisor</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/remi"
            onClick={onClose}
            className="remi-panel-link"
            title="Open full conversation"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </Link>
          <button type="button" onClick={onClose} className="remi-panel-close" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages / empty state */}
      <div className="remi-panel-body">
        {!hasMessages ? (
          <div className="flex h-full flex-col items-start justify-end gap-4 pb-2">
            <div>
              <p className="text-[14px] font-semibold text-[var(--text-primary)]">Hi there 👋</p>
              <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">Ask me anything about your finances.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="remi-panel-chip"
                  onClick={() => send(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="remi-panel-input-row">
        <AutoTextarea
          value={input}
          onChange={setInput}
          onSubmit={() => send(input)}
          disabled={sending}
        />
        <button
          type="button"
          className="remi-panel-send"
          onClick={() => send(input)}
          disabled={sending || !input.trim()}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function RemiFab({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="remi-fab"
      aria-label={open ? "Close Remi" : "Open Remi"}
    >
      {open ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 10h.01M12 10h.01M16 10h.01" />
        </svg>
      )}
    </button>
  );
}
