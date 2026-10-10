"use client";

import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { api, ApiError, errorMessage } from "@/lib/api";
import type { Version } from "@/lib/types";

import { useToast } from "../toast";
import { Button, ErrorNote, Field, Modal, Textarea } from "../ui";

type Mode = "approve" | "changes" | null;

export function DecisionButtons({
  version,
  openComments,
  onDecided,
}: {
  version: Version;
  openComments: number;
  onDecided: (v: Version) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState(0);

  function open(m: Mode) {
    setMode(m);
    setNote("");
    setError(null);
    setUnresolved(m === "approve" ? openComments : 0);
  }

  async function submit(acknowledge: boolean) {
    setBusy(true);
    setError(null);
    try {
      const path = mode === "approve" ? "approve" : "request-changes";
      const v = await api<Version>(`/api/versions/${version.id}/${path}`, {
        method: "POST",
        body: { note: note.trim(), acknowledge_unresolved: acknowledge },
      });
      toast.success(mode === "approve" ? `V${v.version_number} approved.` : "Changes requested. The editor will see your comments.");
      setMode(null);
      onDecided(v);
    } catch (e) {
      if (e instanceof ApiError && e.code === "unresolved_feedback") {
        setUnresolved(Number(e.extra.unresolved ?? 1));
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const approved = version.approval_status === "approved";
  const changes = version.approval_status === "changes_requested";

  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" variant={changes ? "secondary" : "danger"} onClick={() => open("changes")} disabled={changes}>
          <RotateCcw className="size-4" aria-hidden />
          <span className="hidden sm:inline">Request changes</span>
          <span className="sm:hidden">Changes</span>
        </Button>
        <Button size="sm" variant="success" onClick={() => open("approve")} disabled={approved}>
          <CheckCircle2 className="size-4" aria-hidden />
          {approved ? "Approved" : "Approve"}
        </Button>
      </div>

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === "approve" ? `Approve V${version.version_number}?` : `Request changes on V${version.version_number}`}
      >
        <div className="space-y-4">
          {mode === "approve" ? (
            unresolved > 0 ? (
              <div className="flex gap-2.5 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {unresolved} comment{unresolved === 1 ? " is" : "s are"} still unresolved on this version.
                  Resolve {unresolved === 1 ? "it" : "them"} first, or approve anyway if{" "}
                  {unresolved === 1 ? "it no longer applies" : "they no longer apply"}.
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted">
                This records your approval of exactly this version. A later upload will need its own review.
              </p>
            )
          ) : (
            <p className="text-sm text-muted">
              The editor will see your timestamped comments and upload a new version.
            </p>
          )}
          <Field label="Note" htmlFor="decision-note" hint="Optional.">
            <Textarea
              id="decision-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={5000}
              placeholder={mode === "approve" ? "Good to publish." : "See the comments on the timeline."}
            />
          </Field>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
            {mode === "approve" ? (
              <Button variant="success" loading={busy} onClick={() => submit(unresolved > 0)}>
                {unresolved > 0 ? "Approve anyway" : "Approve"}
              </Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={() => submit(false)}>
                Request changes
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
