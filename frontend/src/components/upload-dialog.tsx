"use client";

import { CheckCircle2, FileVideo, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import type { Version } from "@/lib/types";
import { UploadCancelled, Uploader, type UploadProgress } from "@/lib/uploader";

import { useSession } from "./session";
import { Button, ErrorNote, Field, Modal, Textarea } from "./ui";

type Stage = "pick" | "uploading" | "done" | "error";

export function checkFile(
  file: File,
  allowed: string[],
  maxBytes: number,
): string | null {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  if (!allowed.includes(ext)) {
    return `“${file.name}” is not a supported video. Use ${allowed.map((e) => e.toUpperCase()).join(", ")}.`;
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > maxBytes) {
    return `This file is ${formatBytes(file.size)}, over the ${formatBytes(maxBytes)} limit.`;
  }
  return null;
}

export function UploadDialog({
  open,
  onClose,
  projectId,
  nextVersion,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  nextVersion: number;
  onUploaded: (v: Version) => void;
}) {
  const { config } = useSession();
  const allowed = config?.allowed_extensions ?? ["mp4", "mov", "m4v", "webm"];
  const maxBytes = config?.max_upload_bytes ?? 10 * 1024 ** 3;

  // Fixed when the dialog opens; the project refreshing after the upload must
  // not change the title under the confirmation.
  const [versionNumber] = useState(nextVersion);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("pick");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<Version | null>(null);
  const uploader = useRef<Uploader | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Warn before leaving the page mid-upload.
  useEffect(() => {
    if (stage !== "uploading") return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [stage]);

  function choose(f: File | undefined | null) {
    if (!f) return;
    uploader.current = null;
    setError(checkFile(f, allowed, maxBytes));
    setFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files?.[0]);
  }

  async function start() {
    if (!file || checkFile(file, allowed, maxBytes)) return;
    setStage("uploading");
    setError(null);
    // Retrying after an error reuses the uploader, which resumes server-side.
    const u =
      stage === "error" && uploader.current
        ? uploader.current
        : new Uploader({ projectId, file, notes, onProgress: setProgress });
    uploader.current = u;
    try {
      const v = await u.start();
      setResult(v);
      setStage("done");
      onUploaded(v);
    } catch (err) {
      if (err instanceof UploadCancelled) {
        setStage("pick");
        setProgress(null);
        return;
      }
      setError(errorMessage(err));
      setStage("error");
    }
  }

  async function cancel() {
    await uploader.current?.cancel();
    setStage("pick");
    setProgress(null);
  }

  const pct = progress ? Math.floor((progress.loaded / progress.total) * 100) : 0;
  const playable =
    file && typeof document !== "undefined"
      ? document.createElement("video").canPlayType(file.type || "video/mp4")
      : "maybe";

  return (
    <Modal
      open={open}
      onClose={stage === "uploading" ? () => {} : onClose}
      title={`Upload version ${versionNumber}`}
    >
      {stage === "done" && result ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto size-10 text-ok" aria-hidden />
          <div>
            <p className="font-medium">Version {result.version_number} uploaded</p>
            <p className="mt-1 text-sm text-muted">Reviewers can watch it and leave feedback now.</p>
          </div>
          <Button variant="primary" onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {stage === "pick" || stage === "error" ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                dragging ? "border-accent bg-accent/5" : "border-line",
              )}
            >
              {file ? (
                <>
                  <FileVideo className="size-8 text-muted" aria-hidden />
                  <p className="mt-2 max-w-full truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted">{formatBytes(file.size)}</p>
                  <button
                    type="button"
                    onClick={() => input.current?.click()}
                    className="mt-2 text-xs text-accent underline underline-offset-2"
                  >
                    Choose a different file
                  </button>
                </>
              ) : (
                <>
                  <UploadCloud className="size-8 text-muted" aria-hidden />
                  <p className="mt-2 text-sm">Drag a video here, or</p>
                  <Button type="button" size="sm" className="mt-2" onClick={() => input.current?.click()}>
                    Browse files
                  </Button>
                  <p className="mt-3 text-xs text-faint">
                    {allowed.map((e) => e.toUpperCase()).join(", ")} · up to {formatBytes(maxBytes)}
                  </p>
                </>
              )}
              <input
                ref={input}
                type="file"
                accept={allowed.map((e) => `.${e}`).join(",") + ",video/*"}
                className="sr-only"
                aria-label="Video file"
                data-testid="file-input"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </div>
          ) : null}

          {file && playable === "" && !error ? (
            <p className="text-xs text-warn">
              This browser may not play this format. It will still be stored unchanged; H.264 MP4
              plays everywhere.
            </p>
          ) : null}

          {stage === "pick" || stage === "error" ? (
            <Field label="Version notes" htmlFor="notes" hint="Optional. What changed in this version?">
              <Textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Updated logo and color."
                maxLength={5000}
              />
            </Field>
          ) : null}

          {stage === "uploading" && progress ? (
            <div className="space-y-2" aria-live="polite">
              <div className="flex items-baseline justify-between text-sm">
                <span className="truncate pr-3">{file?.name}</span>
                <span className="tabular shrink-0 text-muted">{pct}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label="Upload progress"
              >
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <p className="tabular text-xs text-muted">
                {progress.phase === "finalizing"
                  ? "Checking the file…"
                  : progress.phase === "retrying"
                    ? `Connection interrupted — retrying (attempt ${progress.attempt})…`
                    : `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}`}
              </p>
            </div>
          ) : null}

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <div className="flex justify-end gap-2">
            {stage === "uploading" ? (
              <Button variant="ghost" onClick={cancel} disabled={progress?.phase === "finalizing"}>
                Cancel upload
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  onClick={start}
                  disabled={!file || !!checkFile(file, allowed, maxBytes)}
                >
                  {stage === "error" ? "Try again" : "Upload"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
