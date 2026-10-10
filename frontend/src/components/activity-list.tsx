"use client";

import { formatRelative, formatTimecode } from "@/lib/format";
import type { ActivityItem } from "@/lib/types";

export function describeActivity(a: ActivityItem): string {
  const d = a.data as Record<string, string | number | null | undefined>;
  const v = d.version_number ? `V${d.version_number}` : "a version";
  switch (a.event_type) {
    case "project_created":
      return "created the project";
    case "project_updated":
      return "updated the project details";
    case "members_updated":
      return "changed who is on the project";
    case "version_uploaded":
      return `uploaded ${v}`;
    case "comment_added":
      return d.timestamp_ms != null
        ? `commented on ${v} at ${formatTimecode(Number(d.timestamp_ms))}`
        : `commented on ${v}`;
    case "reply_added":
      return "replied to a comment";
    case "comment_resolved":
      return "resolved a comment";
    case "comment_reopened":
      return "reopened a comment";
    case "comment_deleted":
      return "deleted a comment";
    case "version_approved":
      return `approved ${v}`;
    case "changes_requested":
      return `requested changes on ${v}`;
    default:
      return a.event_type.replaceAll("_", " ");
  }
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="text-sm leading-snug">
          <span className="font-medium">{a.actor?.display_name ?? "Someone"}</span>{" "}
          <span className="text-muted">{describeActivity(a)}</span>
          {typeof a.data.excerpt === "string" && a.data.excerpt ? (
            <span className="mt-0.5 block truncate text-xs text-faint">“{a.data.excerpt}”</span>
          ) : null}
          <span className="block text-xs text-faint">{formatRelative(a.created_at)}</span>
        </li>
      ))}
    </ol>
  );
}
