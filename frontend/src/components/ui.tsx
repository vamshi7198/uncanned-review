"use client";

import { Loader2, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@/lib/cn";
import { statusLabel } from "@/lib/format";
import type { ApprovalStatus, ProjectStatus } from "@/lib/types";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-strong font-semibold",
  secondary: "border border-line-strong bg-surface-2 text-fg hover:bg-surface-3",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
  success: "bg-ok text-[#06140d] font-semibold hover:brightness-110",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
  icon: "h-9 w-9",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25",
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const STATUS_STYLE: Record<ProjectStatus, string> = {
  draft: "bg-surface-3 text-muted",
  in_review: "bg-info/12 text-info",
  changes_requested: "bg-warn/12 text-warn",
  approved: "bg-ok/12 text-ok",
};

const STATUS_DOT: Record<ProjectStatus, string> = {
  draft: "bg-faint",
  in_review: "bg-info",
  changes_requested: "bg-warn",
  approved: "bg-ok",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ProjectStatus | ApprovalStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_STYLE[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} aria-hidden />
      {statusLabel(status)}
    </span>
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-muted", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </span>
  );
}

export function ErrorNote({
  children,
  onRetry,
  className,
}: {
  children: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger",
        className,
      )}
    >
      <span>{children}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 font-medium underline underline-offset-2"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-faint">{icon}</div> : null}
      <h3 className="text-base font-medium text-fg">{title}</h3>
      {children ? <div className="mt-1 max-w-sm text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-muted",
        className,
      )}
    >
      {letters || "?"}
    </span>
  );
}

/** Native <dialog>: focus trapping and Escape handling come from the browser. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
