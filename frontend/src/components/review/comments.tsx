"use client";

import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Eraser,
  MessageSquarePlus,
  PenLine,
  Pencil,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative, formatTimecode } from "@/lib/format";
import type { Annotation, Comment } from "@/lib/types";

import { Avatar, Button, ErrorNote, Spinner, Textarea } from "../ui";
import type { Tool } from "./annotation";

export type Filter = "all" | "open" | "resolved" | "general";

export interface Draft {
  timestampMs: number | null;
  annotation: Annotation | null;
  text: string;
}

export function filterComments(comments: Comment[], f: Filter): Comment[] {
  switch (f) {
    case "open":
      return comments.filter((c) => !c.is_resolved && !c.is_deleted);
    case "resolved":
      return comments.filter((c) => c.is_resolved);
    case "general":
      return comments.filter((c) => c.timestamp_ms == null);
    default:
      return comments;
  }
}

interface Actions {
  onReply: (id: string, text: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => Promise<void>;
  onEdit: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function CommentPanel({
  comments,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  canReview,
  currentMs,
  draft,
  onStartDraft,
  onDraftChange,
  onCancelDraft,
  onSubmitDraft,
  drawing,
  tool,
  onToolChange,
  onToggleDrawing,
  actions,
  header,
}: {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (c: Comment) => void;
  canReview: boolean;
  currentMs: number;
  draft: Draft | null;
  onStartDraft: (timestamped: boolean) => void;
  onDraftChange: (d: Draft) => void;
  onCancelDraft: () => void;
  onSubmitDraft: () => Promise<void>;
  drawing: boolean;
  tool: Tool;
  onToolChange: (t: Tool) => void;
  onToggleDrawing: () => void;
  actions: Actions;
  header?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const list = filterComments(comments, filter);
  const timed = list.filter((c) => c.timestamp_ms != null);
  const general = list.filter((c) => c.timestamp_ms == null);

  const counts: Record<Filter, number> = {
    all: comments.filter((c) => !c.is_deleted).length,
    open: filterComments(comments, "open").length,
    resolved: filterComments(comments, "resolved").length,
    general: filterComments(comments, "general").filter((c) => !c.is_deleted).length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="border-b border-line p-3">
        {draft ? (
          <Composer
            draft={draft}
            currentMs={currentMs}
            onChange={onDraftChange}
            onCancel={onCancelDraft}
            onSubmit={onSubmitDraft}
            drawing={drawing}
            tool={tool}
            onToolChange={onToolChange}
            onToggleDrawing={onToggleDrawing}
          />
        ) : (
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={() => onStartDraft(true)}>
              <MessageSquarePlus className="size-4" aria-hidden />
              <span>
                Comment at <span className="tabular font-mono">{formatTimecode(currentMs)}</span>
              </span>
            </Button>
            <Button variant="ghost" onClick={() => onStartDraft(false)} title="Comment on the whole video">
              General
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2" role="tablist" aria-label="Filter comments">
        {(["all", "open", "resolved", "general"] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs whitespace-nowrap capitalize transition-colors",
              filter === f ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {f === "open" ? "Unresolved" : f} <span className="tabular opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" data-testid="comment-list">
        {error ? (
          <div className="p-3">
            <ErrorNote onRetry={onRetry}>{error}</ErrorNote>
          </div>
        ) : loading && comments.length === 0 ? (
          <div className="p-6 text-center">
            <Spinner label="Loading comments" />
          </div>
        ) : list.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {comments.length === 0
              ? "No feedback yet. Pause on a frame and add a comment."
              : "No comments match this filter."}
          </p>
        ) : (
          <>
            {timed.length > 0 ? (
              <ul className="divide-y divide-line">
                {timed.map((c) => (
                  <CommentItem
                    key={c.id}
                    comment={c}
                    selected={selectedId === c.id}
                    onSelect={onSelect}
                    canReview={canReview}
                    actions={actions}
                  />
                ))}
              </ul>
            ) : null}
            {general.length > 0 ? (
              <>
                <h3 className="border-y border-line bg-surface-2/60 px-4 py-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">
                  General comments
                </h3>
                <ul className="divide-y divide-line">
                  {general.map((c) => (
                    <CommentItem
                      key={c.id}
                      comment={c}
                      selected={selectedId === c.id}
                      onSelect={onSelect}
                      canReview={canReview}
                      actions={actions}
                    />
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function submitOnCmdEnter(e: KeyboardEvent, submit: () => void) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit();
  }
}

function Composer({
  draft,
  currentMs,
  onChange,
  onCancel,
  onSubmit,
  drawing,
  tool,
  onToolChange,
  onToggleDrawing,
}: {
  draft: Draft;
  currentMs: number;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
  drawing: boolean;
  tool: Tool;
  onToolChange: (t: Tool) => void;
  onToggleDrawing: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
  }, []);

  async function submit() {
    if (!draft.text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const moved = draft.timestampMs != null && Math.abs(currentMs - draft.timestampMs) > 20;
  const shapes = draft.annotation?.shapes.length ?? 0;

  return (
    <div className="space-y-2" data-testid="composer">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {draft.timestampMs != null ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 font-mono text-accent" data-testid="draft-timestamp">
              <Clock className="size-3.5" aria-hidden />
              {formatTimecode(draft.timestampMs)}
            </span>
            {moved ? (
              <button
                type="button"
                className="text-muted underline underline-offset-2 hover:text-fg"
                onClick={() => onChange({ ...draft, timestampMs: currentMs, annotation: null })}
              >
                Use {formatTimecode(currentMs)} instead
              </button>
            ) : null}
            <button
              type="button"
              className="ml-auto text-muted hover:text-fg"
              onClick={() => onChange({ ...draft, timestampMs: null, annotation: null })}
            >
              Make general
            </button>
          </>
        ) : (
          <>
            <span className="rounded-md bg-surface-3 px-2 py-1 text-muted">General comment</span>
            <button
              type="button"
              className="ml-auto text-muted hover:text-fg"
              onClick={() => onChange({ ...draft, timestampMs: currentMs })}
            >
              Attach to {formatTimecode(currentMs)}
            </button>
          </>
        )}
      </div>

      {draft.timestampMs != null ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Drawing tools">
          <Button
            size="sm"
            variant={drawing ? "primary" : "secondary"}
            onClick={onToggleDrawing}
            aria-pressed={drawing}
          >
            <PenLine className="size-3.5" aria-hidden />
            {drawing ? "Drawing" : "Draw on frame"}
          </Button>
          {drawing ? (
            <>
              {(
                [
                  ["arrow", ArrowUpRight, "Arrow"],
                  ["rect", Square, "Box"],
                  ["freehand", PenLine, "Pen"],
                ] as const
              ).map(([t, Icon, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onToolChange(t)}
                  aria-pressed={tool === t}
                  title={label}
                  className={cn(
                    "flex h-8 items-center gap-1 rounded-md px-2 text-xs",
                    tool === t ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              ))}
              {shapes > 0 ? (
                <button
                  type="button"
                  onClick={() => onChange({ ...draft, annotation: null })}
                  className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted hover:text-fg"
                >
                  <Eraser className="size-3.5" aria-hidden /> Clear
                </button>
              ) : null}
            </>
          ) : shapes > 0 ? (
            <span className="text-xs text-muted">
              {shapes} mark{shapes === 1 ? "" : "s"} drawn
            </span>
          ) : null}
        </div>
      ) : null}

      <label htmlFor="comment-text" className="sr-only">
        Comment
      </label>
      <Textarea
        id="comment-text"
        ref={area}
        rows={3}
        value={draft.text}
        maxLength={5000}
        placeholder="What should change here?"
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
        onKeyDown={(e) => {
          submitOnCmdEnter(e, submit);
          if (e.key === "Escape") onCancel();
        }}
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="hidden text-[11px] text-faint sm:inline">Ctrl/⌘ + Enter to post</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={submit} loading={busy} disabled={!draft.text.trim()}>
            Post comment
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  comment: c,
  selected,
  onSelect,
  canReview,
  actions,
}: {
  comment: Comment;
  selected: boolean;
  onSelect: (c: Comment) => void;
  canReview: boolean;
  actions: Actions;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      ref={ref}
      className={cn(
        "px-4 py-3 transition-colors",
        selected ? "bg-accent/[0.07] shadow-[inset_3px_0_0_var(--color-accent)]" : "",
        c.is_resolved && !selected ? "opacity-60" : "",
      )}
      data-testid="comment"
      data-comment-id={c.id}
      aria-current={selected ? "true" : undefined}
    >
      <Body
        c={c}
        onSelect={() => onSelect(c)}
        onEdit={(t) => actions.onEdit(c.id, t)}
        onDelete={() => actions.onDelete(c.id)}
      />

      {c.is_resolved ? (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-ok">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Resolved{c.resolved_by ? ` by ${c.resolved_by.display_name}` : ""}
        </p>
      ) : null}

      {c.replies.length > 0 ? (
        <ul className="mt-3 space-y-3 border-l border-line pl-3">
          {c.replies.map((r) => (
            <li key={r.id}>
              <Body
                c={r}
                small
                onEdit={(t) => actions.onEdit(r.id, t)}
                onDelete={() => actions.onDelete(r.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <ErrorNote className="mt-2">{error}</ErrorNote> : null}

      {replying ? (
        <ReplyBox
          onCancel={() => setReplying(false)}
          onSubmit={async (t) => {
            await actions.onReply(c.id, t);
            setReplying(false);
          }}
        />
      ) : !c.is_deleted ? (
        <div className="mt-2 flex gap-3 text-xs">
          <button type="button" className="text-muted hover:text-fg" onClick={() => setReplying(true)}>
            Reply
          </button>
          {canReview ? (
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-1 text-muted hover:text-fg disabled:opacity-50"
              onClick={() => run(() => actions.onResolve(c.id, !c.is_resolved))}
            >
              {c.is_resolved ? (
                <>
                  <RotateCcw className="size-3" aria-hidden /> Reopen
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3" aria-hidden /> Resolve
                </>
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Body({
  c,
  small,
  onSelect,
  onEdit,
  onDelete,
}: {
  c: Comment;
  small?: boolean;
  onSelect?: () => void;
  onEdit: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onEdit(text.trim());
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="group">
      <div className="flex items-center gap-2">
        <Avatar name={c.author?.display_name ?? "?"} className={small ? "size-6 text-[10px]" : undefined} />
        <span className="truncate text-sm font-medium">{c.author?.display_name ?? "Former member"}</span>
        <span className="shrink-0 text-xs text-faint" title={new Date(c.created_at).toLocaleString()}>
          {formatRelative(c.created_at)}
          {c.is_edited ? " · edited" : ""}
        </span>
        {!c.is_deleted && (c.can_edit || c.can_delete) && !editing ? (
          <span className="ml-auto flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            {c.can_edit ? (
              <button
                type="button"
                onClick={() => {
                  setText(c.text);
                  setEditing(true);
                }}
                className="rounded p-1 text-faint hover:text-fg"
                aria-label="Edit comment"
              >
                <Pencil className="size-3.5" />
              </button>
            ) : null}
            {c.can_delete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded p-1 text-faint hover:text-danger"
                aria-label="Delete comment"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className={cn("mt-1.5", small ? "pl-8" : "pl-9")}>
        {c.timestamp_ms != null && onSelect ? (
          <button
            type="button"
            onClick={onSelect}
            className="mr-2 inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 align-baseline font-mono text-xs text-accent hover:bg-accent/25"
            aria-label={`Go to ${formatTimecode(c.timestamp_ms)}`}
            data-testid="comment-timestamp"
          >
            {formatTimecode(c.timestamp_ms)}
            {c.annotation ? <PenLine className="size-3" aria-label="Has drawing" /> : null}
          </button>
        ) : null}
        {c.is_deleted ? (
          <span className="text-sm text-faint italic">This comment was deleted.</span>
        ) : editing ? (
          <div className="mt-1 space-y-2">
            <Textarea
              rows={3}
              value={text}
              autoFocus
              aria-label="Edit comment"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                submitOnCmdEnter(e, save);
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={save} loading={busy}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <span className="text-sm leading-relaxed break-words whitespace-pre-wrap">{c.text}</span>
        )}
        {confirmDelete ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs">
            <span className="text-danger">Delete this comment?</span>
            <Button size="sm" variant="danger" onClick={remove} loading={busy}>
              Delete
            </Button>
            <button type="button" className="text-muted hover:text-fg" onClick={() => setConfirmDelete(false)}>
              <X className="size-3.5" aria-label="Keep comment" />
            </button>
          </div>
        ) : null}
        {error ? <ErrorNote className="mt-2">{error}</ErrorNote> : null}
      </div>
    </div>
  );
}

function ReplyBox({ onSubmit, onCancel }: { onSubmit: (t: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 pl-9">
      <Textarea
        rows={2}
        value={text}
        autoFocus
        aria-label="Reply"
        placeholder="Reply…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          submitOnCmdEnter(e, submit);
          if (e.key === "Escape") onCancel();
        }}
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={submit} loading={busy} disabled={!text.trim()}>
          Reply
        </Button>
      </div>
    </div>
  );
}
