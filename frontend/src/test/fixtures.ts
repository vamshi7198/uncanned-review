import type { Comment, ProjectDetail, ProjectSummary, Version } from "@/lib/types";

export const reviewer = { id: "u-r", display_name: "Riya Reviewer", email: "r@example.com", role: "reviewer" as const };
export const editor = { id: "u-e", display_name: "Eddie Editor", email: "e@example.com", role: "editor" as const };

export function makeVersion(n: number, over: Partial<Version> = {}): Version {
  return {
    id: `v${n}`,
    project_id: "p1",
    version_number: n,
    original_filename: `reel-v${n}.mp4`,
    content_type: "video/mp4",
    size_bytes: 1000,
    checksum_sha256: "0".repeat(64),
    duration_ms: 20000,
    frame_rate: 25,
    variable_frame_rate: false,
    width: 1080,
    height: 1920,
    video_codec: "h264",
    playback_warning: null,
    has_thumbnail: false,
    uploaded_by: editor,
    notes: "",
    status: "ready",
    approval_status: "in_review",
    is_latest: true,
    open_comments: 0,
    created_at: "2026-10-10T10:00:00Z",
    ...over,
  };
}

export function makeComment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    version_id: "v1",
    parent_id: null,
    author: reviewer,
    timestamp_ms: 12400,
    text: "Move the logo slightly higher.",
    annotation: null,
    is_resolved: false,
    resolved_by: null,
    resolved_at: null,
    is_deleted: false,
    is_edited: false,
    created_at: "2026-10-10T10:00:00Z",
    updated_at: "2026-10-10T10:00:00Z",
    replies: [],
    can_edit: true,
    can_delete: true,
    ...over,
  };
}

export function makeProject(over: Partial<ProjectDetail> = {}): ProjectDetail {
  const versions = over.versions ?? [makeVersion(1)];
  return {
    id: "p1",
    name: "Uncanned Instagram Reel",
    description: "",
    is_archived: false,
    status: versions[0]?.approval_status ?? "draft",
    latest_version: versions[0] ?? null,
    version_count: versions.length,
    open_comments: 0,
    last_activity_at: "2026-10-10T10:00:00Z",
    updated_at: "2026-10-10T10:00:00Z",
    created_at: "2026-10-10T10:00:00Z",
    my_role: "reviewer",
    members: [
      { user: editor, role: "editor", can_approve: false },
      { user: reviewer, role: "reviewer", can_approve: true },
    ],
    versions,
    permissions: { can_upload: false, can_review: true, can_decide: true, can_manage: false },
    ...over,
  };
}

export function summary(over: Partial<ProjectSummary> = {}): ProjectSummary {
  const { members: _m, versions: _v, permissions: _p, created_at: _c, ...rest } = makeProject();
  return { ...rest, ...over };
}
