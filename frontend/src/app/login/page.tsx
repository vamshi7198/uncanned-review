"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/components/login-form";
import { useAppName, useSession } from "@/components/session";
import { Spinner } from "@/components/ui";
import { safeNext } from "@/lib/nav";

function LoginInner() {
  const { user, loading, config, setUser } = useSession();
  const appName = useAppName();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (loading) return;
    if (user) router.replace(next);
    else if (config?.needs_setup) router.replace("/setup");
  }, [loading, user, config, router, next]);

  if (loading || user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <AuthCard appName={appName} title="Sign in" subtitle="Review and approve video work.">
      <LoginForm
        onSignedIn={(u) => {
          setUser(u);
          router.replace(next);
        }}
      />
      <p className="mt-5 text-center text-xs text-faint">
        Accounts are created by your administrator.
      </p>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
