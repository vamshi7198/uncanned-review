"use client";

import { Film } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { Version } from "@/lib/types";

export function Thumbnail({ version, className }: { version: Version | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const show = version?.has_thumbnail && !failed;
  return (
    <div
      className={cn(
        "relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-surface-3",
        className,
      )}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
        <img
          src={`/api/versions/${version!.id}/thumbnail`}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Film className="size-6 text-faint" aria-hidden />
      )}
      {version?.duration_ms ? (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {formatDuration(version.duration_ms)}
        </span>
      ) : null}
    </div>
  );
}
