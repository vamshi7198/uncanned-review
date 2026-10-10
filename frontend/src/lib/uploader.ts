/**
 * Chunked, resumable upload of one video file.
 *
 * Each chunk is sent with the byte offset it starts at. After any failure the
 * uploader asks the server how much it actually stored and resumes from
 * there, so a dropped connection never corrupts or duplicates data.
 */

import { api, ApiError, readCookie } from "./api";
import type { UploadSession, Version } from "./types";

export interface UploadProgress {
  loaded: number;
  total: number;
  phase: "uploading" | "retrying" | "finalizing";
  attempt: number;
}

export interface UploadOptions {
  projectId: string;
  file: File;
  notes?: string;
  onProgress?: (p: UploadProgress) => void;
  maxRetries?: number;
  /** Injected in tests. */
  sendChunk?: typeof sendChunkXhr;
  sleep?: (ms: number) => Promise<void>;
}

export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled.");
    this.name = "UploadCancelled";
  }
}

const RETRYABLE = new Set([0, 408, 409, 429, 500, 502, 503, 504]);

export function sendChunkXhr(
  uploadId: string,
  offset: number,
  blob: Blob,
  onLoaded: (bytes: number) => void,
  signal: AbortSignal,
): Promise<UploadSession> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/uploads/${uploadId}/chunk?offset=${offset}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    const csrf = readCookie("ur_csrf");
    if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => {
      let data: { error?: { code?: string; message?: string } } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page from a proxy */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as unknown as UploadSession);
      } else {
        const { code, message, ...extra } = data?.error ?? {};
        reject(
          new ApiError(
            xhr.status,
            code ?? "http_error",
            message ?? `Upload failed (${xhr.status}).`,
            extra,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(0, "network_error", "The connection was interrupted."));
    xhr.ontimeout = xhr.onerror;
    const abort = () => xhr.abort();
    signal.addEventListener("abort", () => {
      abort();
      reject(new UploadCancelled());
    });
    xhr.send(blob);
  });
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Uploader {
  private readonly controller = new AbortController();
  private session: UploadSession | null = null;

  constructor(private readonly opts: UploadOptions) {}

  get uploadId(): string | null {
    return this.session?.id ?? null;
  }

  async start(): Promise<Version> {
    const { projectId, file, notes = "", onProgress } = this.opts;
    const send = this.opts.sendChunk ?? sendChunkXhr;
    const sleep = this.opts.sleep ?? defaultSleep;
    const maxRetries = this.opts.maxRetries ?? 6;

    // Calling start() again after a failure resumes the same server session.
    if (this.session) {
      const s = await api<UploadSession>(`/api/uploads/${this.session.id}`);
      if (s.status === "completed") return this.finalize(s.id, maxRetries, sleep);
      this.session = s.status === "uploading" ? s : null;
    }
    if (!this.session) {
      this.session = await api<UploadSession>(`/api/projects/${projectId}/uploads`, {
        method: "POST",
        body: { filename: file.name, size: file.size, notes },
      });
    }
    const id = this.session.id;
    const chunkSize = this.session.chunk_size;
    let offset = this.session.received_bytes;
    let attempt = 0;

    const report = (loaded: number, phase: UploadProgress["phase"]) =>
      onProgress?.({ loaded, total: file.size, phase, attempt });

    report(offset, "uploading");

    while (offset < file.size) {
      this.throwIfCancelled();
      const end = Math.min(offset + chunkSize, file.size);
      try {
        const base = offset;
        const res = await send(
          id,
          offset,
          file.slice(offset, end),
          (n) => report(base + n, "uploading"),
          this.controller.signal,
        );
        offset = res.received_bytes;
        attempt = 0;
        report(offset, "uploading");
      } catch (err) {
        if (err instanceof UploadCancelled) throw err;
        this.throwIfCancelled();
        const status = err instanceof ApiError ? err.status : 0;
        if (!RETRYABLE.has(status) || attempt >= maxRetries) throw err;
        attempt++;
        report(offset, "retrying");
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
        // Ask the server where to resume; it is the source of truth.
        try {
          const s = await api<UploadSession>(`/api/uploads/${id}`);
          if (s.status !== "uploading") throw err;
          offset = s.received_bytes;
        } catch (inner) {
          if (inner === err) throw err;
          // Server still unreachable: keep the old offset and retry.
        }
      }
    }

    report(file.size, "finalizing");
    this.throwIfCancelled();
    return this.finalize(id, maxRetries, sleep);
  }

  private async finalize(
    id: string,
    maxRetries: number,
    sleep: (ms: number) => Promise<void>,
  ): Promise<Version> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api<Version>(`/api/uploads/${id}/finalize`, { method: "POST" });
      } catch (err) {
        // Finalize is idempotent on the server, so retrying is safe.
        const status = err instanceof ApiError ? err.status : 0;
        if (![0, 502, 503, 504].includes(status) || attempt >= maxRetries) throw err;
        await sleep(Math.min(1000 * 2 ** attempt, 15_000));
      }
    }
  }

  private throwIfCancelled() {
    if (this.controller.signal.aborted) throw new UploadCancelled();
  }

  async cancel(): Promise<void> {
    this.controller.abort();
    if (this.session) {
      await api(`/api/uploads/${this.session.id}`, { method: "DELETE" }).catch(() => {});
    }
  }
}
