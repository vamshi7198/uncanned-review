import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeVersion } from "@/test/fixtures";
import { mockFetch } from "@/test/mock-fetch";

import { checkFile, UploadDialog } from "./upload-dialog";

vi.mock("./session", () => ({
  useSession: () => ({
    config: { max_upload_bytes: 1000, allowed_extensions: ["mp4", "mov", "webm"] },
  }),
}));

const mp4 = (name = "reel-v2.mp4", size = 10) =>
  new File([new Uint8Array(size)], name, { type: "video/mp4" });

describe("checkFile", () => {
  it("rejects wrong type, empty and oversized files", () => {
    expect(checkFile(mp4("notes.pdf"), ["mp4"], 100)).toMatch(/not a supported video/);
    expect(checkFile(mp4("a.mp4", 0), ["mp4"], 100)).toMatch(/empty/);
    expect(checkFile(mp4("a.mp4", 200), ["mp4"], 100)).toMatch(/over the/);
    expect(checkFile(mp4("A.MP4", 10), ["mp4"], 100)).toBeNull();
  });
});

describe("UploadDialog", () => {
  it("explains an unsupported file and keeps Upload disabled", async () => {
    render(<UploadDialog open onClose={vi.fn()} projectId="p1" nextVersion={2} onUploaded={vi.fn()} />);
    await userEvent.upload(screen.getByTestId("file-input"), new File(["x"], "script.html", { type: "text/html" }), {
      applyAccept: false,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/not a supported video/);
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("uploads with notes and shows completion", async () => {
    const { calls } = mockFetch({
      "POST /api/projects/p1/uploads": {
        id: "up1", project_id: "p1", original_filename: "reel-v2.mp4", expected_size: 10,
        received_bytes: 0, status: "uploading", chunk_size: 100, version_id: null, expires_at: "",
      },
      "POST /api/uploads/up1/finalize": makeVersion(2),
    });
    // XHR chunk upload, stubbed.
    class FakeXHR {
      status = 200;
      responseText = "";
      upload = { onprogress: null as null | ((e: { loaded: number }) => void) };
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      ontimeout: null | (() => void) = null;
      withCredentials = false;
      open() {}
      setRequestHeader() {}
      abort() {}
      send(blob: Blob) {
        this.upload.onprogress?.({ loaded: blob.size });
        this.responseText = JSON.stringify({ received_bytes: 10, status: "uploading", chunk_size: 100 });
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const onUploaded = vi.fn();
    render(<UploadDialog open onClose={vi.fn()} projectId="p1" nextVersion={2} onUploaded={onUploaded} />);
    await userEvent.upload(screen.getByTestId("file-input"), mp4());
    await userEvent.type(screen.getByLabelText("Version notes"), "Updated logo and color.");
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Version 2 uploaded")).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalled();
    expect(calls[0]!.body).toEqual({ filename: "reel-v2.mp4", size: 10, notes: "Updated logo and color." });
  });
});
