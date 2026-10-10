"use client";

import type { Member, ProjectRole, UserBrief } from "@/lib/types";

import { Avatar } from "./ui";

export interface MemberDraft {
  user_id: string;
  role: ProjectRole;
  can_approve: boolean;
}

export function toDrafts(members: Member[]): MemberDraft[] {
  return members.map((m) => ({ user_id: m.user.id, role: m.role, can_approve: m.can_approve }));
}

/**
 * Pick each person's part in the project: editor, reviewer, or not involved.
 * Reviewers can be made comment-only by unticking "Can approve".
 */
export function MemberPicker({
  people,
  value,
  onChange,
}: {
  people: UserBrief[];
  value: MemberDraft[];
  onChange: (v: MemberDraft[]) => void;
}) {
  const byId = new Map(value.map((m) => [m.user_id, m]));

  function setRole(user: UserBrief, role: ProjectRole | "") {
    const rest = value.filter((m) => m.user_id !== user.id);
    onChange(role ? [...rest, { user_id: user.id, role, can_approve: role === "reviewer" }] : rest);
  }

  function setApprove(userId: string, can: boolean) {
    onChange(value.map((m) => (m.user_id === userId ? { ...m, can_approve: can } : m)));
  }

  if (people.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">
        No other people yet. Add editors and reviewers on the People page first.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {people.map((p) => {
        const m = byId.get(p.id);
        const selectId = `role-${p.id}`;
        return (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <Avatar name={p.display_name} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{p.display_name}</div>
              <div className="truncate text-xs text-faint">{p.email}</div>
            </div>
            {m?.role === "reviewer" ? (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={m.can_approve}
                  onChange={(e) => setApprove(p.id, e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Can approve
              </label>
            ) : null}
            <label htmlFor={selectId} className="sr-only">
              Role for {p.display_name}
            </label>
            <select
              id={selectId}
              value={m?.role ?? ""}
              onChange={(e) => setRole(p, e.target.value as ProjectRole | "")}
              className="h-8 rounded-md border border-line bg-surface-2 px-2 text-sm"
            >
              <option value="">Not on project</option>
              <option value="editor">Editor</option>
              <option value="reviewer">Reviewer</option>
            </select>
          </li>
        );
      })}
    </ul>
  );
}
