"use client";

import {
  ArrowLeft,
  Download,
  Link2,
  MessageSquare,
  Pencil,
  Play,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ActivityList } from "@/components/activity-list";
import { AppShell } from "@/components/app-shell";
import { MemberPicker, toDrafts, type MemberDraft } from "@/components/member-picker";
import { Thumbnail } from "@/components/thumbnail";
import { useToast } from "@/components/toast";
import {
  Avatar,
  Button,
  buttonClass,
  ErrorNote,
  Field,
  Input,
  Modal,
  Spinner,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatDate, formatDuration, formatRelative } from "@/lib/format";
import type {
  ActivityItem,
  ApprovalRecord,
  ProjectDetail,
  UserBrief,
  Version,
} from "@/lib/types";
import { useResource } from "@/lib/use-resource";

function ProjectView({ id }: { id: string }) {
  const toast = useToast();
  const project = useResource(() => api<ProjectDetail>(`/api/projects/${id}`), id);
  const activity = useResource(
    () => api<{ items: ActivityItem[] }>(`/api/projects/${id}/activity?limit=15`),
    id,
  );
  const approvals = useResource(() => api<ApprovalRecord[]>(`/api/projects/${id}/approvals`), id);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Refresh in place: the current data stays on screen (and open dialogs stay
  // mounted) until the new data arrives.
  const reload = () => {
    void project.reload();
    void activity.reload();
    void approvals.reload();
  };

  if (project.error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorNote onRetry={project.reload}>{project.error}</ErrorNote>
      </div>
    );
  }
  if (!project.data) {
    return (
      <div className="py-20 text-center">
        <Spinner label="Loading project" />
      </div>
    );
  }

  const p = project.data;
  const latest = p.latest_version;
  const editors = p.members.filter((m) => m.role === "editor");
  const reviewers = p.members.filter((m) => m.role === "reviewer");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied. Only people on this project can open it.");
    } catch {
      toast.error("Could not copy. Copy the address from the browser bar instead.");
    }
  }

  return (
    <div>
      <BackLink />
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            <StatusBadge status={p.status} />
            {p.is_archived ? (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">Archived</span>
            ) : null}
          </div>
          {p.description ? (
            <p className="mt-1.5 max-w-2xl text-sm whitespace-pre-line text-muted">{p.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={copyLink}>
            <Link2 className="size-4" aria-hidden /> Copy link
          </Button>
          {p.permissions.can_manage ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPeopleOpen(true)}>
                <Users className="size-4" aria-hidden /> People
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          {/* Latest version */}
          <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="latest-h">
            <h2 id="latest-h" className="sr-only">
              Latest version
            </h2>
            {latest ? (
              <div className="flex flex-col gap-4 sm:flex-row">
                <Link href={`/projects/${p.id}/review/${latest.id}`} className="group relative block sm:w-72">
                  <Thumbnail version={latest} />
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 transition-colors group-hover:bg-black/30">
                    <Play className="size-10 text-white opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </span>
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-accent">V{latest.version_number}</span>
                    <span className="text-xs text-faint">Latest</span>
                  </div>
                  <p className="mt-1 truncate text-sm">{latest.original_filename}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {latest.uploaded_by?.display_name ?? "Unknown"} · {formatRelative(latest.created_at)} ·{" "}
                    {formatDuration(latest.duration_ms)} · {formatBytes(latest.size_bytes)}
                  </p>
                  {latest.notes ? (
                    <p className="mt-2 line-clamp-3 text-sm whitespace-pre-line text-muted">{latest.notes}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusBadge status={latest.approval_status} />
                    {latest.open_comments > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-warn">
                        <MessageSquare className="size-3.5" aria-hidden /> {latest.open_comments} open
                        comment{latest.open_comments === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <Link href={`/projects/${p.id}/review/${latest.id}`} className={buttonClass("primary")}>
                      <Play className="size-4" aria-hidden /> Open review
                    </Link>
                    {p.permissions.can_upload ? (
                      <Button onClick={() => setUploadOpen(true)}>
                        <Upload className="size-4" aria-hidden /> Upload new version
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="font-medium">No video yet</p>
                <p className="mt-1 text-sm text-muted">
                  {p.permissions.can_upload
                    ? "Upload the first cut to start the review."
                    : editors.length
                      ? `Waiting for ${editors.map((e) => e.user.display_name).join(", ")} to upload the first cut.`
                      : "No editor is assigned yet."}
                </p>
                {p.permissions.can_upload ? (
                  <Button variant="primary" className="mt-4" onClick={() => setUploadOpen(true)}>
                    <Upload className="size-4" aria-hidden /> Upload video
                  </Button>
                ) : null}
              </div>
            )}
          </section>

          {/* Version history */}
          {p.versions.length > 0 ? (
            <section aria-labelledby="versions-h">
              <h2 id="versions-h" className="mb-3 text-sm font-medium text-muted">
                Version history
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {p.versions.map((v) => (
                  <VersionRow key={v.id} projectId={p.id} v={v} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="people-h">
            <h2 id="people-h" className="mb-3 text-sm font-medium text-muted">
              People
            </h2>
            <PeopleList title="Editor" people={editors.map((m) => m.user)} />
            <PeopleList
              title="Reviewers"
              people={reviewers.map((m) => m.user)}
              note={(u) => (reviewers.find((r) => r.user.id === u.id)?.can_approve ? "" : "comments only")}
            />
          </section>

          {approvals.data && approvals.data.length > 0 ? (
            <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="decisions-h">
              <h2 id="decisions-h" className="mb-3 text-sm font-medium text-muted">
                Decisions
              </h2>
              <ol className="space-y-3">
                {approvals.data.slice(0, 8).map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className={a.decision === "approved" ? "text-ok" : "text-warn"}>
                      {a.decision === "approved" ? "Approved" : "Changes requested"}
                    </span>{" "}
                    <span className="font-mono text-xs text-muted">V{a.version_number}</span>
                    <span className="block text-xs text-faint">
                      {a.reviewer?.display_name ?? "Someone"} · {formatDate(a.created_at)}
                    </span>
                    {a.note ? <span className="mt-0.5 block text-xs text-muted">“{a.note}”</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="activity-h">
            <h2 id="activity-h" className="mb-3 text-sm font-medium text-muted">
              Recent activity
            </h2>
            {activity.data ? <ActivityList items={activity.data.items} /> : <Spinner />}
          </section>
        </aside>
      </div>

      {uploadOpen ? (
        <UploadDialog
          open
          onClose={() => setUploadOpen(false)}
          projectId={p.id}
          nextVersion={(latest?.version_number ?? 0) + 1}
          onUploaded={() => reload()}
        />
      ) : null}
      {p.permissions.can_manage ? (
        <>
          {peopleOpen ? (
          <PeopleDialog
            open={peopleOpen}
            onClose={() => setPeopleOpen(false)}
            project={p}
            onSaved={() => {
              setPeopleOpen(false);
              reload();
            }}
          />
          ) : null}
          {editOpen ? (
          <EditDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            project={p}
            onSaved={() => {
              setEditOpen(false);
              reload();
            }}
          />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
      <ArrowLeft className="size-4" aria-hidden /> Projects
    </Link>
  );
}

function VersionRow({ projectId, v }: { projectId: string; v: Version }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-surface-2">
      <span className={cn("w-9 font-mono text-sm", v.is_latest ? "text-accent" : "text-muted")}>
        V{v.version_number}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={`/projects/${projectId}/review/${v.id}`}
          className="block truncate text-sm hover:underline"
        >
          {v.notes || v.original_filename}
        </Link>
        <p className="truncate text-xs text-faint">
          {v.uploaded_by?.display_name ?? "Unknown"} · {formatDate(v.created_at)}
          {v.notes ? ` · ${v.original_filename}` : ""}
        </p>
      </div>
      {v.open_comments > 0 ? (
        <span className="inline-flex items-center gap-1 text-xs text-warn">
          <MessageSquare className="size-3.5" aria-hidden /> {v.open_comments}
        </span>
      ) : null}
      <StatusBadge status={v.approval_status} />
      <a
        href={`/api/versions/${v.id}/download`}
        className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg"
        aria-label={`Download V${v.version_number}`}
        title="Download original"
      >
        <Download className="size-4" />
      </a>
    </li>
  );
}

function PeopleList({
  title,
  people,
  note,
}: {
  title: string;
  people: UserBrief[];
  note?: (u: UserBrief) => string;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-xs text-faint">{title}</div>
      {people.length === 0 ? (
        <p className="text-sm text-muted">None assigned</p>
      ) : (
        <ul className="space-y-1.5">
          {people.map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-sm">
              <Avatar name={u.display_name} className="size-6 text-[10px]" />
              <span className="truncate">{u.display_name}</span>
              {note?.(u) ? <span className="text-xs text-faint">{note(u)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PeopleDialog({
  open,
  onClose,
  project,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectDetail;
  onSaved: () => void;
}) {
  const toast = useToast();
  const people = useResource(() => api<UserBrief[]>("/api/users/directory"), `dir:${open}`);
  const [draft, setDraft] = useState<MemberDraft[]>(toDrafts(project.members));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${project.id}/members`, { method: "PUT", body: { members: draft } });
      toast.success("People updated.");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const others = (people.data ?? []).filter((u) => u.role !== "admin" || draft.some((d) => d.user_id === u.id));

  return (
    <Modal open={open} onClose={onClose} title="People on this project" wide>
      <div className="space-y-4">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {people.loading ? <Spinner /> : <MemberPicker people={others} value={draft} onChange={setDraft} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditDialog({
  open,
  onClose,
  project,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectDetail;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: patch });
      toast.success(message);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit project">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Name is required.");
          void save({ name: name.trim(), description }, "Project updated.");
        }}
      >
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Field label="Name" htmlFor="edit-name">
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Description" htmlFor="edit-desc">
          <Textarea id="edit-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              save(
                { is_archived: !project.is_archived },
                project.is_archived ? "Project restored." : "Project archived.",
              )
            }
          >
            {project.is_archived ? "Restore project" : "Archive project"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  return <AppShell>{id ? <ProjectView id={id} /> : null}</AppShell>;
}
