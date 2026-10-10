import type { ApprovalStatus, ProjectStatus } from "./types";

/** 12400 -> "00:12.400"; 3725123 -> "1:02:05.123". */
export function formatTimecode(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const h = Math.floor(safe / 3_600_000);
  const m = Math.floor((safe % 3_600_000) / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  const frac = safe % 1000;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const fff = String(frac).padStart(3, "0");
  return h > 0 ? `${h}:${mm}:${ss}.${fff}` : `${mm}:${ss}.${fff}`;
}

/** Short form for durations: "0:42", "12:03", "1:02:05". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diff = (now.getTime() - then.getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 7 * 86_400) {
    const d = Math.round(diff / 86_400);
    return d === 1 ? "yesterday" : `${d} days ago`;
  }
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "No video yet",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export function statusLabel(s: ProjectStatus | ApprovalStatus): string {
  return STATUS_LABEL[s] ?? s;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
