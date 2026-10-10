import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { mockFetch } from "@/test/mock-fetch";
import { makeVersion, summary } from "@/test/fixtures";

import { Dashboard } from "./dashboard";

vi.mock("./session", () => ({
  useSession: () => ({ user: { id: "a", role: "admin", display_name: "Admin" }, config: null }),
}));

describe("Dashboard", () => {
  it("lists projects with version, status and open comments", async () => {
    mockFetch({
      "GET /api/projects": {
        items: [
          summary({
            name: "Mango Blaze Reel",
            status: "changes_requested",
            open_comments: 2,
            latest_version: makeVersion(3, { approval_status: "changes_requested" }),
          }),
        ],
        total: 1,
      },
    });
    render(<Dashboard />);
    const list = await screen.findByRole("list", { name: "Projects" });
    const card = within(list).getByRole("link");
    expect(card).toHaveTextContent("Mango Blaze Reel");
    expect(card).toHaveTextContent("V3");
    expect(card).toHaveTextContent("Changes requested");
    expect(card).toHaveTextContent("2 open");
    expect(card).toHaveAttribute("href", "/projects/p1");
  });

  it("shows an empty state with a create action for admins", async () => {
    mockFetch({ "GET /api/projects": { items: [], total: 0 } });
    render(<Dashboard />);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /New project/ }).length).toBeGreaterThan(0);
  });

  it("shows an error with retry", async () => {
    let fail = true;
    mockFetch({
      "GET /api/projects": () =>
        fail
          ? { status: 500, body: { error: { code: "internal_error", message: "Something went wrong. Please try again." } } }
          : { body: { items: [summary()], total: 1 } },
    });
    render(<Dashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Uncanned Instagram Reel")).toBeInTheDocument();
  });

  it("sends the chosen filter", async () => {
    const { calls } = mockFetch({ "GET /api/projects": { items: [], total: 0 } });
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("tab", { name: "Needs my review" }));
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes("filter=needs_review"))).toBe(true));
  });
});
