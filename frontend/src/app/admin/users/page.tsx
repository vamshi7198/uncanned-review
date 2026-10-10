"use client";

import { KeyRound, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Avatar, Button, ErrorNote, Field, Input, Modal, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import type { Role, User } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

const ROLE_HELP: Record<Role, string> = {
  admin: "Manages people and projects; can do everything.",
  reviewer: "Watches, comments, resolves, and approves when allowed.",
  editor: "Uploads versions and replies to feedback.",
};

function suggestPassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function People() {
  const { user: me } = useSession();
  const toast = useToast();
  const users = useResource(() => api<User[]>("/api/users"), "users");
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<User | null>(null);

  if (me && me.role !== "admin") return <ErrorNote>Only administrators can manage people.</ErrorNote>;

  async function update(u: User, patch: Partial<User> & { password?: string }, message: string) {
    try {
      const updated = await api<User>(`/api/users/${u.id}`, { method: "PATCH", body: patch });
      users.setData((list) => (list ?? []).map((x) => (x.id === u.id ? updated : x)));
      toast.success(message);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="mt-0.5 text-sm text-muted">Only people you add here can sign in.</p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <UserPlus className="size-4" aria-hidden /> Add person
        </Button>
      </div>

      <div className="mt-6">
        {users.error ? (
          <ErrorNote onRetry={users.reload}>{users.error}</ErrorNote>
        ) : !users.data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {users.data.map((u) => (
              <li key={u.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !u.is_active && "opacity-55")}>
                <Avatar name={u.display_name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {u.display_name}
                    {u.id === me?.id ? <span className="ml-1.5 text-xs text-faint">(you)</span> : null}
                    {!u.is_active ? <span className="ml-1.5 text-xs text-danger">Disabled</span> : null}
                  </div>
                  <div className="truncate text-xs text-faint">
                    {u.email} · added {formatDate(u.created_at)}
                  </div>
                </div>
                <label className="sr-only" htmlFor={`role-${u.id}`}>
                  Role for {u.display_name}
                </label>
                <select
                  id={`role-${u.id}`}
                  value={u.role}
                  disabled={u.id === me?.id}
                  onChange={(e) => update(u, { role: e.target.value as Role }, "Role updated.")}
                  className="h-8 rounded-md border border-line bg-surface-2 px-2 text-sm disabled:opacity-60"
                >
                  <option value="admin">Admin</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="editor">Editor</option>
                </select>
                {u.id !== me?.id ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setResetFor(u)}>
                      <KeyRound className="size-3.5" aria-hidden /> Reset password
                    </Button>
                    <Button
                      size="sm"
                      variant={u.is_active ? "danger" : "secondary"}
                      onClick={() =>
                        update(
                          u,
                          { is_active: !u.is_active },
                          u.is_active ? `${u.display_name} can no longer sign in.` : `${u.display_name} re-enabled.`,
                        )
                      }
                    >
                      {u.is_active ? "Disable" : "Enable"}
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {createOpen ? (
        <CreateDialog
          onClose={() => setCreateOpen(false)}
          // Stay open: the dialog then shows the sign-in details to pass on.
          onCreated={(u) => users.setData((list) => [...(list ?? []), u])}
        />
      ) : null}
      {resetFor ? (
        <ResetDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={async (pw) => {
            await update(resetFor, { password: pw }, "Password reset. They will be asked to change it.");
            setResetFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (u: User) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ display_name: "", email: "", role: "reviewer" as Role, password: suggestPassword() });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<User | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await api<User>("/api/users", { method: "POST", body: form });
      setCreated(u);
      onCreated(u);
      toast.success(`${u.display_name} added.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Modal open onClose={onClose} title="Person added">
        <div className="space-y-3 text-sm">
          <p>Share these sign-in details with {created.display_name} privately. They will be asked to choose a new password.</p>
          <div className="space-y-1 rounded-lg bg-surface-2 p-3 font-mono text-xs">
            <div>Email: {created.email}</div>
            <div>Temporary password: {form.password}</div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Add person">
      <form onSubmit={submit} className="space-y-4">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Field label="Name" htmlFor="new-name">
          <Input id="new-name" required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="new-email">
          <Input id="new-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Role" htmlFor="new-role" hint={ROLE_HELP[form.role]}>
          <select
            id="new-role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm"
          >
            <option value="reviewer">Reviewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Temporary password" htmlFor="new-password" hint="At least 10 characters. They will change it at first sign-in.">
          <Input id="new-password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Add person
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetDialog({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState(suggestPassword());
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Reset password for ${user.display_name}`}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onDone(pw);
          setBusy(false);
        }}
      >
        <p className="text-sm text-muted">They will be signed out everywhere and asked to choose a new password.</p>
        <Field label="Temporary password" htmlFor="reset-pw">
          <Input id="reset-pw" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} className="font-mono" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Reset password
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function PeoplePage() {
  return (
    <AppShell>
      <People />
    </AppShell>
  );
}
