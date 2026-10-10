"use client";

import { Clapperboard, LogOut, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { useAppName, useRequireUser, useSession } from "./session";
import { Avatar, Spinner } from "./ui";

export function AppShell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const user = useRequireUser();
  const { logout } = useSession();
  const appName = useAppName();
  const pathname = usePathname();
  const router = useRouter();

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const nav = [
    { href: "/", label: "Projects", icon: Clapperboard, show: true },
    { href: "/admin/users", label: "People", icon: Users, show: user.role === "admin" },
    { href: "/settings", label: "Settings", icon: Settings, show: true },
  ].filter((n) => n.show);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg">
              <Clapperboard className="size-4" aria-hidden />
            </span>
            <span className="hidden sm:inline">{appName}</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Main">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" || pathname.startsWith("/projects") : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-right text-xs leading-tight md:block">
              <span className="block text-fg">{user.display_name}</span>
              <span className="block capitalize text-faint">{user.role}</span>
            </span>
            <Avatar name={user.display_name} />
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
              className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>
      {user.must_change_password && !pathname.startsWith("/settings") ? (
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
          Your password was set by an administrator.{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            Choose your own password
          </Link>
          .
        </div>
      ) : null}
      <main className={cn("flex-1", bare ? "" : "mx-auto w-full max-w-6xl px-4 py-6 sm:py-8")}>
        {children}
      </main>
    </div>
  );
}
