"use client";

import { useState, type FormEvent } from "react";

import { api, errorMessage } from "@/lib/api";
import type { User } from "@/lib/types";

import { Button, ErrorNote, Field, Input } from "./ui";

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export function validateLogin(email: string, password: string) {
  const errors: { email?: string; password?: string } = {};
  if (!email.trim()) errors.email = "Enter your email.";
  else if (!EMAIL.test(email.trim())) errors.email = "Enter a valid email address.";
  if (!password) errors.password = "Enter your password.";
  return errors;
}

export function LoginForm({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const errs = validateLogin(email, password);
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await api<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: { email: email.trim(), password },
      });
      onSignedIn(res.user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!fieldErrors.email}
        />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldErrors.password}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!fieldErrors.password}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        Sign in
      </Button>
    </form>
  );
}
