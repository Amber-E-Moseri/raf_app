// Shared components used by both the full Remi page and the floating panel.
import React from "react";

export function parseInline(text: string, prefix = ""): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index));
    if (m[1] != null) tokens.push(<strong key={`${prefix}b${n++}`}>{m[1]}</strong>);
    else if (m[2] != null) tokens.push(
      <code key={`${prefix}c${n++}`} className="rounded bg-[var(--surface-muted)] px-1 py-0.5 font-mono text-[0.82em]">
        {m[2]}
      </code>,
    );
    else if (m[3] != null) tokens.push(<em key={`${prefix}e${n++}`}>{m[3]}</em>);
    last = re.lastIndex;
  }

  if (last < text.length) tokens.push(text.slice(last));
  return tokens;
}

export function RemiMarkdown({ content }: { content: string }) {
  const chunks = content.split(/\n{2,}/);
  const nodes: React.ReactNode[] = [];

  chunks.forEach((chunk, ci) => {
    const lines = chunk.split("\n").filter((l) => l !== "");
    if (!lines.length) return;

    const firstLine = lines[0];

    const hm = firstLine.match(/^(#{1,3})\s+(.+)$/);
    if (hm && lines.length === 1) {
      const level = hm[1].length;
      const cls =
        level === 1
          ? "text-[15px] font-bold leading-snug text-[var(--text-primary)]"
          : "text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]";
      nodes.push(<p key={ci} className={cls}>{parseInline(hm[2], `h${ci}`)}</p>);
      return;
    }

    const bulletLines = lines.filter((l) => /^[-*]\s+/.test(l));
    if (bulletLines.length >= Math.ceil(lines.length * 0.75)) {
      nodes.push(
        <ul key={ci} className="space-y-1.5">
          {lines.map((line, li) => {
            const im = line.match(/^[-*]\s+(.+)$/);
            if (!im) return null;
            return (
              <li key={li} className="flex gap-2 text-[14px] leading-[1.65]">
                <span className="mt-[0.45em] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: "var(--theme-primary)" }} />
                <span className="min-w-0">{parseInline(im[1], `li${ci}-${li}`)}</span>
              </li>
            );
          })}
        </ul>,
      );
      return;
    }

    nodes.push(
      <p key={ci} className="text-[14px] leading-[1.7] text-[var(--text-primary)]">
        {lines.flatMap((line, li) => [
          ...(li > 0 ? [<br key={`br-${ci}-${li}`} />] : []),
          ...parseInline(line, `p${ci}-${li}`),
        ])}
      </p>,
    );
  });

  return <div className="space-y-3">{nodes}</div>;
}

export function RemiAvatar({ size = "sm" }: { size?: "sm" | "md" }) {
  const sz = size === "md" ? "h-8 w-8 text-[13px]" : "h-7 w-7 text-[11px]";
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${sz}`}
      style={{ background: "var(--theme-primary)", color: "#fff" }}
    >
      R
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-end gap-2.5">
      <RemiAvatar />
      <div
        className="flex items-center gap-1.5 rounded-[1.25rem] rounded-bl-[0.35rem] px-4 py-3"
        style={{ background: "var(--surface-muted)" }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-[6px] w-[6px] rounded-full"
            style={{
              background: "var(--text-subtle)",
              animation: `remi-dot 1.3s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export interface MessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  loading?: boolean;
}

export function ChatBubble({ msg }: { msg: MessageItem }) {
  if (msg.loading) return <TypingIndicator />;

  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[82%] rounded-[1.25rem] rounded-br-[0.35rem] px-4 py-3 text-[14px] leading-[1.65]"
          style={{ background: "var(--theme-primary)", color: "#fff" }}
        >
          {msg.content.split("\n").map((line, i) => (
            <p key={i} className={i > 0 ? "mt-1.5" : ""}>{line}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2.5">
      <RemiAvatar />
      <div
        className="max-w-[86%] rounded-[1.25rem] rounded-bl-[0.35rem] px-4 py-3"
        style={{ background: "var(--surface-muted)" }}
      >
        <RemiMarkdown content={msg.content} />
      </div>
    </div>
  );
}

let _id = 0;
export function uid() { return `remi-${++_id}`; }
