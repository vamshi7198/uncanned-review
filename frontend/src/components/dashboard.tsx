"use client";

import { Clapperboard, MessageSquare, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import type { ProjectSummary } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

import { useSession } from "./session";
import { Thumbnail } from "./thumbnail";
import { buttonClass, EmptyState, ErrorNote, Spinner, StatusBadge } from "./ui";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs my review" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "approved", label: "Approved" },
  { key: "archived", label: "Archived" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export function Dashboard() {
  const { user } = useSession();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const projects = useResource(
    () =>
      api<{ items: ProjectSummary[]; total: number }>(
        `/api/projects?q=${encodeURIComponent(debounced)}&filter=${filter}&limit=100`,
      ),
    `${debounced}|${filter}`,
  );

  const isAdmin = user?.role === "admin";
  const items = projects.data?.items ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-0.5 text-sm text-muted">Every creative, with its versions and feedback.</p>
        </div>
        {isAdmin ? (
          <Link href="/projects/new" className={buttonClass("primary")}>
            <Plus className="size-4" aria-hidden />
            New project
          </Link>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter projects">
          {FILTERS.filter((f) => f.key !== "archived" || isAdmin).map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                filter === f.key ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="relative block md:w-72">
          <span className="sr-only">Search projects</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="h-9 w-full rounded-lg border border-line bg-surface-2 pr-3 pl-9 text-sm placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-5">
        {projects.error ? (
          <ErrorNote onRetry={projects.reload}>{projects.error}</ErrorNote>
        ) : projects.loading && !projects.data ? (
          <div className="py-16 text-center">
            <Spinner label="Loading projects" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Clapperboard className="size-8" />}
            title={debounced || filter !== "all" ? "No matching projects" : "No projects yet"}
            action={
              isAdmin && !debounced && filter === "all" ? (
                <Link href="/projects/new" className={buttonClass("primary")}>
                  <Plus className="size-4" aria-hidden />
                  New project
                </Link>
              ) : null
            }
          >
            {debounced || filter !== "all"
              ? "Try a different search or filter."
              : isAdmin
                ? "Create a project, add your editor and reviewers, and the editor can upload the first cut."
                : "You will see projects here once an administrator adds you to one."}
          </EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Projects">
            {items.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project: p }: { project: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${p.id}`}
      className="group block rounded-xl border border-line bg-surface p-3 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <Thumbnail version={p.latest_version} />
      <div className="mt-3 flex items-start justify-between gap-2 px-0.5">
        <h2 className="line-clamp-2 font-medium leading-snug">{p.name}</h2>
        {p.latest_version ? (
          <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-muted">
            V{p.latest_version.version_number}
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5 text-xs text-muted">
        <StatusBadge status={p.status} />
        {p.open_comments > 0 ? (
          <span className="inline-flex items-center gap-1 text-warn">
            <MessageSquare className="size-3.5" aria-hidden />
            {p.open_comments} open
          </span>
        ) : null}
        <span className="ml-auto text-faint">Active {formatRelative(p.last_activity_at)}</span>
      </div>
    </Link>
  );
}
