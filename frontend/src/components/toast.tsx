"use client";

import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

const ToastContext = createContext<(kind: Toast["kind"], message: string) => void>(() => {});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: Toast["kind"], message: string) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-xl",
              t.kind === "success"
                ? "border-ok/30 bg-[#11201a] text-fg"
                : "border-danger/30 bg-[#2a1416] text-fg",
            )}
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-muted hover:text-fg"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    success: (m: string) => push("success", m),
    error: (m: string) => push("error", m),
  };
}
