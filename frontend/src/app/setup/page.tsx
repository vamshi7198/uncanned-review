"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard } from "@/components/auth-card";
import { useAppName, useSession } from "@/components/session";
import { Button, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";

export default function SetupPage() {
  const { config, loading, setUser, refresh } = useSession();
  const appName = useAppName();
  const router = useRouter();
  const [form, setForm] = useState({ token: "", display_name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && config && !config.needs_setup) router.replace("/login");
  }, [loading, config, router]);

  if (loading || !config) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!config.setup_enabled) {
    return (
      <AuthCard appName={appName} title="Create the first administrator">
        <div className="space-y-3 text-sm text-muted">
          <p>Web setup is turned off because no setup token is configured.</p>
          <p>Run this on the server instead:</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-fg">
            docker compose exec -it backend python -m app.cli create-admin --email you@company.com --name &quot;Your Name&quot;
          </pre>
          <p>Or set BOOTSTRAP_TOKEN in .env and restart.</p>
        </div>
      </AuthCard>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 10) return setError("Password must be at least 10 characters.");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const res = await api<{ user: User }>("/api/setup", {
        method: "POST",
        body: {
          token: form.token.trim(),
          display_name: form.display_name.trim(),
          email: form.email.trim(),
          password: form.password,
        },
      });
      setUser(res.user);
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthCard
      appName={appName}
      title="Create the first administrator"
      subtitle="This page only works once, while no accounts exist."
    >
      <form onSubmit={submit} className="space-y-4">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Field label="Setup token" htmlFor="token" hint="The BOOTSTRAP_TOKEN value from the server's .env file.">
          <Input id="token" required value={form.token} onChange={set("token")} autoComplete="off" />
        </Field>
        <Field label="Your name" htmlFor="name">
          <Input id="name" required value={form.display_name} onChange={set("display_name")} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" required autoComplete="username" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input id="password" type="password" required autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <Field label="Repeat password" htmlFor="confirm">
          <Input id="confirm" type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Create administrator
        </Button>
      </form>
    </AuthCard>
  );
}
