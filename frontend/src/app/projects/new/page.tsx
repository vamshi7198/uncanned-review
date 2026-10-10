"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { MemberPicker, type MemberDraft } from "@/components/member-picker";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, ErrorNote, Field, Input, Spinner, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { ProjectDetail, UserBrief } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

function NewProject() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();
  const people = useResource(() => api<UserBrief[]>("/api/users/directory"), "dir");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user && user.role !== "admin") {
    return <ErrorNote>Only an administrator can create projects.</ErrorNote>;
  }

  const hasEditor = members.some((m) => m.role === "editor");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the project a name.");
    setBusy(true);
    try {
      const p = await api<ProjectDetail>("/api/projects", {
        method: "POST",
        body: { name: name.trim(), description: description.trim(), members },
      });
      toast.success("Project created.");
      router.push(`/projects/${p.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const others = (people.data ?? []).filter((p) => p.id !== user?.id);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Projects
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">New project</h1>
      <p className="mt-1 text-sm text-muted">
        A project holds every version of one creative, such as a reel or a product film.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5 rounded-xl border border-line bg-surface p-5">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Field label="Project name" htmlFor="name">
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Instagram Reel — Mango Blaze"
            maxLength={200}
            autoFocus
          />
        </Field>
        <Field label="Description" htmlFor="description" hint="Optional. The brief, deliverable or deadline.">
          <Textarea
            id="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
          />
        </Field>
        <div className="space-y-1.5">
          <div className="text-sm font-medium">People</div>
          <p className="text-xs text-muted">
            The editor uploads versions. Reviewers comment, and approve if allowed. As an
            administrator you can always do both.
          </p>
          {people.loading ? (
            <Spinner label="Loading people" />
          ) : people.error ? (
            <ErrorNote onRetry={people.reload}>{people.error}</ErrorNote>
          ) : (
            <MemberPicker people={others} value={members} onChange={setMembers} />
          )}
          {!hasEditor && others.length > 0 ? (
            <p className="text-xs text-warn">No editor assigned yet. You can add one later.</p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Link href="/" className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm text-muted hover:text-fg">
            Cancel
          </Link>
          <Button type="submit" variant="primary" loading={busy}>
            Create project
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <AppShell>
      <NewProject />
    </AppShell>
  );
}
