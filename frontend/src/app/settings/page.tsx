"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";

function Settings() {
  const { user, setUser, logout } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.next.length < 10) return setError("New password must be at least 10 characters.");
    if (form.next !== form.confirm) return setError("New passwords do not match.");
    setBusy(true);
    try {
      const u = await api<User>("/api/auth/change-password", {
        method: "POST",
        body: { current_password: form.current, new_password: form.next },
      });
      setUser(u);
      setForm({ current: "", next: "", confirm: "" });
      toast.success("Password changed. Other devices were signed out.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted">
          Signed in as {user?.display_name} ({user?.email}) · <span className="capitalize">{user?.role}</span>
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Change password</h2>
        {user?.must_change_password ? (
          <p className="text-sm text-warn">Your current password was set by an administrator. Please choose your own.</p>
        ) : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Field label="Current password" htmlFor="current">
          <Input id="current" type="password" autoComplete="current-password" required value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </Field>
        <Field label="New password" htmlFor="next" hint="At least 10 characters.">
          <Input id="next" type="password" autoComplete="new-password" required value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
        </Field>
        <Field label="Repeat new password" htmlFor="confirm">
          <Input id="confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            Change password
          </Button>
        </div>
      </form>

      <div className="flex items-center justify-between rounded-xl border border-line bg-surface p-5">
        <div>
          <h2 className="font-medium">Sign out</h2>
          <p className="text-sm text-muted">End your session on this device.</p>
        </div>
        <Button
          onClick={async () => {
            await logout();
            router.replace("/login");
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <Settings />
    </AppShell>
  );
}
