import type { ActivityEntry } from "../../api/collaborationApi";

const ACTION_LABELS: Record<string, string> = {
  INCOME_CREATED: "added income",
  INCOME_DELETED: "removed income",
  TRANSACTION_CREATED: "added a transaction",
  TRANSACTION_DELETED: "deleted a transaction",
  IMPORT_APPROVED: "approved an import",
  MONTHLY_REVIEW_APPLIED: "applied a monthly review",
  MEMBER_INVITED: "invited a new steward",
  MEMBER_ACCEPTED: "joined the household",
  MEMBER_ROLE_CHANGED: "updated a member's role",
  MEMBER_REMOVED: "removed a member",
  MEMBER_LEFT: "left the household",
  OWNERSHIP_TRANSFERRED: "transferred household ownership",
  WORKSPACE_NAME_CHANGED: "updated the household name",
};

function initials(entry: ActivityEntry): string {
  const name = entry.actorName ?? entry.actorEmail ?? "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function actorLabel(entry: ActivityEntry): string {
  return entry.actorName ?? entry.actorEmail ?? "Someone";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  entries: ActivityEntry[];
  isLoading: boolean;
}

export function ActivityFeed({ entries, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 animate-pulse">
            <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--surface-raised)]" />
            <div className="flex-1 space-y-1.5 pt-1">
              <div className="h-3 w-3/4 rounded bg-[var(--surface-raised)]" />
              <div className="h-2.5 w-1/3 rounded bg-[var(--surface-raised)]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-center text-[13px] text-[var(--text-secondary)] py-6">
        No activity yet. Financial changes made by your household will appear here.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[11px] font-semibold text-[var(--text-primary)]">
            {initials(entry)}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[13px] text-[var(--text-primary)]">
              <span className="font-medium">{actorLabel(entry)}</span>{" "}
              {ACTION_LABELS[entry.action] ?? entry.action.toLowerCase().replace(/_/g, " ")}
              {entry.metadata?.label ? (
                <span className="text-[var(--text-secondary)]"> — {String(entry.metadata.label)}</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{timeAgo(entry.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
