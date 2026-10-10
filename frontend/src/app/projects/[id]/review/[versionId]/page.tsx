"use client";

import { useParams } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ReviewView } from "@/components/review/review-view";

export default function ReviewPage() {
  const { id, versionId } = useParams<{ id: string; versionId: string }>();
  return <AppShell bare>{id && versionId ? <ReviewView key={versionId} projectId={id} versionId={versionId} /> : null}</AppShell>;
}
