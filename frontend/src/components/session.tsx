"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, ApiError } from "@/lib/api";
import type { PublicConfig, User } from "@/lib/types";

interface SessionState {
  config: PublicConfig | null;
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

const DEFAULT_NAME = "Uncanned Review";

async function loadSession(): Promise<{ config: PublicConfig | null; user: User | null }> {
  try {
    const [config, me] = await Promise.all([
      api<PublicConfig>("/api/config"),
      api<{ user: User }>("/api/auth/me").catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }),
    ]);
    return { config, user: me?.user ?? null };
  } catch {
    return { config: null, user: null };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((r: { config: PublicConfig | null; user: User | null }) => {
    if (r.config) setConfig(r.config);
    setUser(r.user);
    setLoading(false);
  }, []);

  const refresh = useCallback(() => loadSession().then(apply), [apply]);

  useEffect(() => {
    let alive = true;
    loadSession().then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("ur:unauthenticated", onExpired);
    return () => window.removeEventListener("ur:unauthenticated", onExpired);
  }, []);

  useEffect(() => {
    if (config) document.title = config.app_name;
  }, [config]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ config, user, loading, setUser, refresh, logout }),
    [config, user, loading, refresh, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function useAppName(): string {
  return useSession().config?.app_name ?? DEFAULT_NAME;
}

/** Sends signed-out visitors to /login, remembering where they were going. */
export function useRequireUser(): User | null {
  const { user, loading, config } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (loading || user) return;
    if (config?.needs_setup) {
      router.replace("/setup");
      return;
    }
    const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}`);
  }, [loading, user, config, router, pathname]);
  return user;
}
