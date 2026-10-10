import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockFetch } from "@/test/mock-fetch";

import { ApiError } from "./api";
import type { UploadSession } from "./types";
import { UploadCancelled, Uploader, type UploadProgress } from "./uploader";

const session = (received: number, extra: Partial<UploadSession> = {}): UploadSession => ({
  id: "up1",
  project_id: "p1",
  original_filename: "reel-v1.mp4",
  expected_size: 10,
  received_bytes: received,
  status: "uploading",
  chunk_size: 4,
  version_id: null,
  expires_at: "",
  ...extra,
});

const version = { id: "v1", version_number: 1 };

function file() {
  return new File([new Uint8Array(10)], "reel-v1.mp4", { type: "video/mp4" });
}

describe("Uploader", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("sends chunks in order with offsets and finalizes", async () => {
    mockFetch({
      "POST /api/projects/p1/uploads": session(0),
      "POST /api/uploads/up1/finalize": version,
    });
    const sent: number[] = [];
    const progress: UploadProgress[] = [];
    const u = new Uploader({
      projectId: "p1",
      file: file(),
      onProgress: (p) => progress.push(p),
      sendChunk: async (_id, offset, blob) => {
        sent.push(offset);
        return session(offset + blob.size);
      },
    });
    await expect(u.start()).resolves.toEqual(version);
    expect(sent).toEqual([0, 4, 8]);
    expect(progress.at(-1)).toMatchObject({ loaded: 10, phase: "finalizing" });
  });

  it("resumes from the server's offset after a dropped connection", async () => {
    let statusCalls = 0;
    mockFetch({
      "POST /api/projects/p1/uploads": session(0),
      "GET /api/uploads/up1": () => {
        statusCalls++;
        return { body: session(4) }; // first chunk did land
      },
      "POST /api/uploads/up1/finalize": version,
    });
    const sent: number[] = [];
    let failed = false;
    const u = new Uploader({
      projectId: "p1",
      file: file(),
      sleep: async () => {},
      sendChunk: async (_id, offset, blob) => {
        sent.push(offset);
        if (offset === 4 && !failed) {
          failed = true;
          throw new ApiError(0, "network_error", "dropped");
        }
        return session(offset + blob.size);
      },
    });
    await u.start();
    expect(statusCalls).toBe(1);
    expect(sent).toEqual([0, 4, 4, 8]);
  });

  it("gives up on non-retryable errors", async () => {
    mockFetch({ "POST /api/projects/p1/uploads": session(0) });
    const u = new Uploader({
      projectId: "p1",
      file: file(),
      sleep: async () => {},
      sendChunk: async () => {
        throw new ApiError(403, "forbidden", "No");
      },
    });
    await expect(u.start()).rejects.toMatchObject({ status: 403 });
  });

  it("cancel aborts and deletes the server session", async () => {
    const { calls } = mockFetch({
      "POST /api/projects/p1/uploads": session(0),
      "DELETE /api/uploads/up1": () => ({ status: 204 }),
    });
    let release: () => void = () => {};
    const u = new Uploader({
      projectId: "p1",
      file: file(),
      sendChunk: (_id, _o, _b, _l, signal) =>
        new Promise((_, reject) => {
          release = () => reject(new UploadCancelled());
          signal.addEventListener("abort", () => release());
        }),
    });
    const run = u.start();
    await vi.waitFor(() => expect(u.uploadId).toBe("up1"));
    await u.cancel();
    await expect(run).rejects.toBeInstanceOf(UploadCancelled);
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/uploads/up1")).toBe(true);
  });

  it("retrying after a failure reuses the same server session", async () => {
    const { calls } = mockFetch({
      "POST /api/projects/p1/uploads": session(0),
      "GET /api/uploads/up1": session(8),
      "POST /api/uploads/up1/finalize": version,
    });
    let attempt = 0;
    const u = new Uploader({
      projectId: "p1",
      file: file(),
      maxRetries: 0,
      sleep: async () => {},
      sendChunk: async (_id, offset, blob) => {
        attempt++;
        if (attempt === 3) throw new ApiError(503, "unavailable", "down");
        return session(offset + blob.size);
      },
    });
    await expect(u.start()).rejects.toBeInstanceOf(ApiError);
    await expect(u.start()).resolves.toEqual(version);
    expect(calls.filter((c) => c.url === "/api/projects/p1/uploads").length).toBe(1);
  });
});
