import { Clapperboard } from "lucide-react";
import type { ReactNode } from "react";

export function AuthCard({
  appName,
  title,
  subtitle,
  children,
}: {
  appName: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Clapperboard className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight">{appName}</span>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-2xl shadow-black/30">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
