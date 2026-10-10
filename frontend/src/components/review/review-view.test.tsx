import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeComment, makeProject, makeVersion } from "@/test/fixtures";
import { mockFetch } from "@/test/mock-fetch";

import { ReviewView } from "./review-view";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const v2 = makeVersion(2, { id: "v2", is_latest: true });
const v1 = makeVersion(1, { id: "v1", is_latest: false, approval_status: "changes_requested" });

function setup(opts: { versionId?: string; comments?: ReturnType<typeof makeComment>[] } = {}) {
  const comments = opts.comments ?? [
    makeComment("c1", { version_id: "v2", timestamp_ms: 12400, text: "Move the logo slightly higher." }),
    makeComment("c2", { version_id: "v2", timestamp_ms: 18200, text: "Reduce the orange saturation.", is_resolved: true }),
    makeComment("c3", { version_id: "v2", timestamp_ms: null, text: "Music is great." }),
  ];
  const mock = mockFetch({
    "GET /api/projects/p1": makeProject({ versions: [v2, v1] }),
    "GET /api/versions/*": comments,
    "POST /api/versions/v2/comments": ({ body }) => ({
      status: 201,
      body: makeComment("new", {
        version_id: "v2",
        timestamp_ms: (body as { timestamp_ms: number | null }).timestamp_ms,
        text: (body as { text: string }).text,
      }),
    }),
    "POST /api/comments/c1/resolve": makeComment("c1", { version_id: "v2", is_resolved: true }),
    "POST /api/versions/v2/approve": ({ body }) =>
      (body as { acknowledge_unresolved: boolean }).acknowledge_unresolved
        ? { body: { ...v2, approval_status: "approved" } }
        : {
            status: 409,
            body: { error: { code: "unresolved_feedback", message: "Unresolved", unresolved: 2 } },
          },
  });
  render(<ReviewView projectId="p1" versionId={opts.versionId ?? "v2"} />);
  return mock;
}

const video = () => screen.getByTestId("video") as HTMLVideoElement;

describe("ReviewView", () => {
  beforeEach(() => push.mockReset());

  it("seeks to the exact comment time, pauses, and highlights the comment", async () => {
    setup();
    await screen.findByText("Move the logo slightly higher.");
    await act(() => video().play());
    expect(video().paused).toBe(false);

    await userEvent.click(screen.getAllByTestId("comment-timestamp")[0]!);

    expect(video().currentTime).toBeCloseTo(12.4, 3);
    expect(video().paused).toBe(true);
    const item = screen.getAllByTestId("comment")[0]!;
    expect(item).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("timecode")).toHaveTextContent("00:12.400");
  });

  it("captures the player's current time when adding a comment", async () => {
    const { calls } = setup();
    await screen.findByText("Move the logo slightly higher.");
    act(() => {
      video().currentTime = 5.04;
    });
    await userEvent.click(screen.getByRole("button", { name: /Comment at 00:05.040/ }));
    expect(video().paused).toBe(true);
    expect(screen.getByTestId("draft-timestamp")).toHaveTextContent("00:05.040");

    await userEvent.type(screen.getByLabelText("Comment"), "Logo too low here");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    const post = await vi.waitFor(() => {
      const c = calls.find((x) => x.method === "POST" && x.url === "/api/versions/v2/comments");
      if (!c) throw new Error("not posted");
      return c;
    });
    expect(post.body).toEqual({ text: "Logo too low here", timestamp_ms: 5040, annotation: null });
    expect(await screen.findByText("Logo too low here")).toBeInTheDocument();
  });

  it("does not hijack keys while typing", async () => {
    setup();
    await screen.findByText("Move the logo slightly higher.");
    await userEvent.click(screen.getByRole("button", { name: /^Comment at/ }));
    const box = screen.getByLabelText("Comment");
    await userEvent.type(box, "a b,c.");
    expect(box).toHaveValue("a b,c.");
    expect(video().paused).toBe(true);
    expect(video().currentTime).toBe(0);
  });

  it("steps one frame with the keyboard at the video's frame rate", async () => {
    setup();
    await screen.findByText("Move the logo slightly higher.");
    act(() => {
      video().currentTime = 12.4;
    });
    fireEvent.keyDown(window, { key: "." });
    // 25 fps -> one frame is 40 ms.
    expect(video().currentTime).toBeCloseTo(12.44, 3);
    fireEvent.keyDown(window, { key: "," });
    fireEvent.keyDown(window, { key: "," });
    expect(video().currentTime).toBeCloseTo(12.36, 3);
    fireEvent.keyDown(window, { key: " " });
    expect(video().paused).toBe(false);
  });

  it("filters to unresolved and groups general comments", async () => {
    setup();
    await screen.findByText("Move the logo slightly higher.");
    expect(screen.getByText("General comments")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Unresolved/ }));
    const list = screen.getByTestId("comment-list");
    expect(within(list).queryByText("Reduce the orange saturation.")).not.toBeInTheDocument();
    expect(within(list).getByText("Move the logo slightly higher.")).toBeInTheDocument();
  });

  it("resolves a comment", async () => {
    setup();
    await screen.findByText("Move the logo slightly higher.");
    const first = screen.getAllByTestId("comment")[0]!;
    await userEvent.click(within(first).getByRole("button", { name: "Resolve" }));
    expect(await within(screen.getAllByTestId("comment")[0]!).findByText(/Resolved/)).toBeInTheDocument();
  });

  it("switches versions and warns on an older version", async () => {
    setup({ versionId: "v1" });
    expect(await screen.findByText(/You are viewing V1, an older version/)).toBeInTheDocument();
    // Decisions are only offered on the latest version.
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Version"), "v2");
    expect(push).toHaveBeenCalledWith("/projects/p1/review/v2");
  });

  it("asks for confirmation before approving with unresolved feedback", async () => {
    const { calls } = setup();
    await screen.findByText("Move the logo slightly higher.");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/2 comments are still unresolved/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve anyway" }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.url === "/api/versions/v2/approve")?.body).toMatchObject({
        acknowledge_unresolved: true,
      }),
    );
  });
});
