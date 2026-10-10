"use client";

import { AlertTriangle, ArrowLeft, Download, Keyboard } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { atTimestamp } from "@/lib/frames";
import type { Comment, ProjectDetail, Version } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

import { useToast } from "../toast";
import { ErrorNote, Modal, Spinner, StatusBadge } from "../ui";
import { AnnotationLayer, type Tool } from "./annotation";
import { CommentPanel, type Draft } from "./comments";
import { DecisionButtons } from "./decision";
import { VideoPlayer, type Marker, type PlayerHandle } from "./player";

/** True when keystrokes belong to a text field, so shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function ReviewView({ projectId, versionId }: { projectId: string; versionId: string }) {
  const router = useRouter();
  const toast = useToast();
  const player = useRef<PlayerHandle>(null);

  const project = useResource(() => api<ProjectDetail>(`/api/projects/${projectId}`), projectId);
  const comments = useResource(() => api<Comment[]>(`/api/versions/${versionId}/comments`), versionId);

  const [currentMs, setCurrentMs] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>("arrow");
  const [helpOpen, setHelpOpen] = useState(false);

  const version: Version | undefined = project.data?.versions.find((v) => v.id === versionId);
  const latest = project.data?.versions[0];
  const list = useMemo(() => comments.data ?? [], [comments.data]);
  const openCount = list.filter((c) => !c.is_resolved && !c.is_deleted).length;

  const markers: Marker[] = useMemo(
    () =>
      list
        .filter((c) => c.timestamp_ms != null && !c.is_deleted)
        .map((c) => ({ id: c.id, ms: c.timestamp_ms!, resolved: c.is_resolved, label: c.text.slice(0, 80) })),
    [list],
  );

  const selectComment = useCallback((c: Comment) => {
    setSelectedId(c.id);
    if (c.timestamp_ms != null) {
      player.current?.pause();
      player.current?.seek(c.timestamp_ms);
    }
  }, []);

  const startDraft = useCallback((timestamped: boolean) => {
    player.current?.pause();
    const ms = player.current?.currentMs() ?? 0;
    setCurrentMs(ms);
    setSelectedId(null);
    setDraft((d) => d ?? { timestampMs: timestamped ? ms : null, annotation: null, text: "" });
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDrawing(false);
  }, []);

  async function submitDraft() {
    if (!draft) return;
    const created = await api<Comment>(`/api/versions/${versionId}/comments`, {
      method: "POST",
      body: {
        text: draft.text.trim(),
        timestamp_ms: draft.timestampMs,
        annotation: draft.timestampMs != null ? draft.annotation : null,
      },
    });
    comments.setData((prev) => sortComments([...(prev ?? []), created]));
    setDraft(null);
    setDrawing(false);
    setSelectedId(created.id);
    void project.reload();
  }

  function replaceThread(updated: Comment) {
    comments.setData((prev) =>
      (prev ?? []).map((c) => (c.id === updated.id ? updated : c)),
    );
  }

  const actions = {
    onReply: async (id: string, text: string) => {
      replaceThread(await api<Comment>(`/api/comments/${id}/replies`, { method: "POST", body: { text } }));
    },
    onResolve: async (id: string, resolved: boolean) => {
      replaceThread(await api<Comment>(`/api/comments/${id}/${resolved ? "resolve" : "reopen"}`, { method: "POST" }));
      void project.reload();
    },
    onEdit: async (id: string, text: string) => {
      replaceThread(await api<Comment>(`/api/comments/${id}`, { method: "PATCH", body: { text } }));
    },
    onDelete: async (id: string) => {
      await api<Comment>(`/api/comments/${id}`, { method: "DELETE" });
      await comments.reload();
      void project.reload();
    },
  };

  // Keyboard shortcuts. Ignored while typing so text entry is never hijacked.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const p = player.current;
      if (!p) return;
      const big = e.shiftKey;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          p.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          p.nudge(big ? -10 : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          p.nudge(big ? 10 : 1);
          break;
        case ",":
          e.preventDefault();
          p.stepFrame(-1);
          break;
        case ".":
          e.preventDefault();
          p.stepFrame(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          p.changeVolume(0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          p.changeVolume(-0.1);
          break;
        case "f":
        case "F":
          e.preventDefault();
          p.toggleFullscreen();
          break;
        case "m":
        case "M":
          p.toggleMute();
          break;
        case "c":
        case "C":
          e.preventDefault();
          startDraft(true);
          break;
        case "?":
          setHelpOpen(true);
          break;
        case "Escape":
          if (drawing) setDrawing(false);
          else if (selectedId) setSelectedId(null);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing, selectedId, startDraft]);

  if (project.error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <ErrorNote onRetry={project.reload}>{project.error}</ErrorNote>
      </div>
    );
  }
  if (!project.data) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
        <Spinner label="Loading review" />
      </div>
    );
  }
  if (!version) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <ErrorNote>This version does not exist or you do not have access to it.</ErrorNote>
        <Link href={`/projects/${projectId}`} className="mt-4 inline-block text-sm text-accent underline">
          Back to project
        </Link>
      </div>
    );
  }

  const p = project.data;
  const selected = list.find((c) => c.id === selectedId) ?? null;

  // What to draw: the draft while composing, otherwise the selected comment's
  // drawing when the player is on its frame.
  const overlayAnnotation = draft
    ? draft.annotation
    : selected?.annotation && selected.timestamp_ms != null && atTimestamp(currentMs, selected.timestamp_ms, version.frame_rate)
      ? selected.annotation
      : null;

  const showOverlay = !!overlayAnnotation || (drawing && draft?.timestampMs != null);

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-3.5rem)]">
      {/* Review header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <Link
          href={`/projects/${p.id}`}
          className="flex min-w-0 items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          <span className="max-w-[40vw] truncate font-medium text-fg">{p.name}</span>
        </Link>
        <label className="sr-only" htmlFor="version-select">
          Version
        </label>
        <select
          id="version-select"
          value={version.id}
          onChange={(e) => router.push(`/projects/${p.id}/review/${e.target.value}`)}
          className="h-8 rounded-md border border-line bg-surface-2 px-2 font-mono text-sm"
        >
          {p.versions.map((v) => (
            <option key={v.id} value={v.id}>
              V{v.version_number}
              {v.is_latest ? " (latest)" : ""} · {formatDate(v.created_at)}
            </option>
          ))}
        </select>
        <StatusBadge status={version.approval_status} />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="hidden rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg md:block"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="size-4" />
          </button>
          <a
            href={`/api/versions/${version.id}/download`}
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Download original"
            title="Download original"
          >
            <Download className="size-4" />
          </a>
          {p.permissions.can_decide && version.is_latest ? (
            <DecisionButtons
              version={version}
              openComments={openCount}
              onDecided={() => void project.reload()}
            />
          ) : null}
        </div>
      </div>

      {!version.is_latest && latest ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-warn/25 bg-warn/10 px-4 py-2 text-sm text-warn">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          You are viewing V{version.version_number}, an older version.
          <Link
            href={`/projects/${p.id}/review/${latest.id}`}
            className="font-medium underline underline-offset-2"
          >
            Go to V{latest.version_number} (latest)
          </Link>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-h-0 flex-col">
          <div className="h-[62vw] max-h-[75vh] min-h-[220px] lg:h-full lg:max-h-none">
            <VideoPlayer
              key={version.id}
              ref={player}
              src={`/api/versions/${version.id}/media`}
              fps={version.frame_rate}
              variableFrameRate={version.variable_frame_rate}
              durationHintMs={version.duration_ms}
              markers={markers}
              selectedId={selectedId}
              onMarkerClick={(id) => {
                const c = list.find((x) => x.id === id);
                if (c) selectComment(c);
              }}
              onTime={setCurrentMs}
              playbackWarning={version.playback_warning}
              downloadUrl={`/api/versions/${version.id}/download`}
              overlay={
                showOverlay ? (
                  <AnnotationLayer
                    annotation={overlayAnnotation}
                    drawing={drawing && draft?.timestampMs != null}
                    tool={tool}
                    onChange={(a) => setDraft((d) => (d ? { ...d, annotation: a } : d))}
                  />
                ) : null
              }
            />
          </div>
          {version.playback_warning ? (
            <p className="border-t border-line bg-surface px-4 py-2 text-xs text-warn">{version.playback_warning}</p>
          ) : null}
          {version.notes ? (
            <p className="hidden border-t border-line bg-surface px-4 py-2 text-sm text-muted lg:block">
              <span className="font-mono text-xs text-faint">V{version.version_number} notes · </span>
              {version.notes}
            </p>
          ) : null}
        </div>

        <aside className="flex min-h-[420px] flex-col border-line bg-surface lg:min-h-0 lg:border-l" aria-label="Comments">
          <CommentPanel
            comments={list}
            loading={comments.loading}
            error={comments.error}
            onRetry={comments.reload}
            selectedId={selectedId}
            onSelect={selectComment}
            canReview={p.permissions.can_review}
            currentMs={currentMs}
            draft={draft}
            onStartDraft={startDraft}
            onDraftChange={setDraft}
            onCancelDraft={cancelDraft}
            onSubmitDraft={async () => {
              await submitDraft();
              toast.success("Comment posted.");
            }}
            drawing={drawing}
            tool={tool}
            onToolChange={setTool}
            onToggleDrawing={() => {
              player.current?.pause();
              setDrawing((d) => !d);
            }}
            actions={actions}
          />
        </aside>
      </div>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {[
            ["Space / K", "Play or pause"],
            ["← / →", "Back / forward 1 second"],
            ["Shift + ← / →", "Back / forward 10 seconds"],
            [", / .", "Previous / next frame"],
            ["↑ / ↓", "Volume"],
            ["M", "Mute"],
            ["F", "Fullscreen"],
            ["C", "Comment at the current frame"],
            ["Ctrl/⌘ + Enter", "Post comment"],
            ["Esc", "Stop drawing, close, or deselect"],
          ].map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}

function sortComments(list: Comment[]): Comment[] {
  return [...list].sort((a, b) => {
    const at = a.timestamp_ms ?? Number.POSITIVE_INFINITY;
    const bt = b.timestamp_ms ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.created_at.localeCompare(b.created_at);
  });
}
