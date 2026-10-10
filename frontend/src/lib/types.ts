export type Role = "admin" | "reviewer" | "editor";
export type ProjectRole = "reviewer" | "editor";
export type ApprovalStatus = "in_review" | "changes_requested" | "approved";
export type ProjectStatus = ApprovalStatus | "draft";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface UserBrief {
  id: string;
  display_name: string;
  email: string;
  role: Role;
}

export interface PublicConfig {
  app_name: string;
  needs_setup: boolean;
  setup_enabled: boolean;
  max_upload_bytes: number;
  allowed_extensions: string[];
}

export interface Version {
  id: string;
  project_id: string;
  version_number: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  duration_ms: number | null;
  frame_rate: number | null;
  variable_frame_rate: boolean;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  playback_warning: string | null;
  has_thumbnail: boolean;
  uploaded_by: UserBrief | null;
  notes: string;
  status: string;
  approval_status: ApprovalStatus;
  is_latest: boolean;
  open_comments: number;
  created_at: string;
}

export interface Member {
  user: UserBrief;
  role: ProjectRole;
  can_approve: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  is_archived: boolean;
  status: ProjectStatus;
  latest_version: Version | null;
  version_count: number;
  open_comments: number;
  last_activity_at: string;
  updated_at: string;
  my_role: string | null;
}

export interface Permissions {
  can_upload: boolean;
  can_review: boolean;
  can_decide: boolean;
  can_manage: boolean;
}

export interface ProjectDetail extends ProjectSummary {
  members: Member[];
  versions: Version[];
  permissions: Permissions;
  created_at: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Shape {
  kind: "arrow" | "rect" | "freehand";
  points: Point[];
}

export interface Annotation {
  shapes: Shape[];
}

export interface Comment {
  id: string;
  version_id: string;
  parent_id: string | null;
  author: UserBrief | null;
  timestamp_ms: number | null;
  text: string;
  annotation: Annotation | null;
  is_resolved: boolean;
  resolved_by: UserBrief | null;
  resolved_at: string | null;
  is_deleted: boolean;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  replies: Comment[];
  can_edit: boolean;
  can_delete: boolean;
}

export interface ApprovalRecord {
  id: string;
  version_id: string;
  version_number: number;
  reviewer: UserBrief | null;
  decision: "approved" | "changes_requested";
  note: string;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  actor: UserBrief | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface UploadSession {
  id: string;
  project_id: string;
  original_filename: string;
  expected_size: number;
  received_bytes: number;
  status: "uploading" | "completed" | "cancelled" | "expired";
  chunk_size: number;
  version_id: string | null;
  expires_at: string;
}
