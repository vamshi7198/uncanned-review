/**
 * The required acceptance scenario (README "Acceptance test"), steps 1–18,
 * 21 and 22. Steps 19–20 (restart, persistence) are in persistence.spec.ts,
 * run by e2e/run-acceptance.sh after the containers are restarted.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { expect, request, test } from "@playwright/test";

import { FIXTURES, PEOPLE, pauseAt, saveState, signIn, videoReady, videoState } from "./helpers";

test.describe.configure({ mode: "serial" });

const BOOTSTRAP_TOKEN = process.env.E2E_BOOTSTRAP_TOKEN ?? "e2e-bootstrap-token";

test("upload → timestamped feedback → revision → approval", async ({ browser, baseURL }) => {
  // ---- First run: create the administrator through the setup page.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await admin.goto("/");
  await expect(admin).toHaveURL(/\/setup$/);
  await admin.getByLabel("Setup token").fill(BOOTSTRAP_TOKEN);
  await admin.getByLabel("Your name").fill(PEOPLE.admin.name);
  await admin.getByLabel("Email").fill(PEOPLE.admin.email);
  await admin.getByLabel("Password", { exact: true }).fill(PEOPLE.admin.password);
  await admin.getByLabel("Repeat password").fill(PEOPLE.admin.password);
  await admin.getByRole("button", { name: "Create administrator" }).click();
  await expect(admin.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

  // ---- Step 1: the administrator creates an editor and a reviewer (and an outsider for step 21).
  await admin.goto("/admin/users");
  for (const [who, role] of [
    [PEOPLE.editor, "editor"],
    [PEOPLE.reviewer, "reviewer"],
    [PEOPLE.outsider, "reviewer"],
  ] as const) {
    await admin.getByRole("button", { name: "Add person" }).first().click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Name").fill(who.name);
    await dialog.getByLabel("Email").fill(who.email);
    await dialog.getByLabel("Role").selectOption(role);
    await dialog.getByLabel("Temporary password").fill(who.password);
    await dialog.getByRole("button", { name: "Add person" }).click();
    await expect(dialog.getByText("Person added")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(admin.getByText(who.email)).toBeVisible();
  }

  // ---- Steps 2–3: create the project and assign the editor and reviewer.
  await admin.goto("/projects/new");
  await admin.getByLabel("Project name").fill("Uncanned Instagram Reel");
  await admin.getByLabel(`Role for ${PEOPLE.editor.name}`).selectOption("editor");
  await admin.getByLabel(`Role for ${PEOPLE.reviewer.name}`).selectOption("reviewer");
  await admin.getByRole("button", { name: "Create project" }).click();
  await expect(admin).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectId = admin.url().split("/").pop()!;
  await expect(admin.getByRole("heading", { name: "Uncanned Instagram Reel" })).toBeVisible();

  // ---- Step 4: the editor signs in and uploads reel-v1.mp4.
  const editor = await signIn(browser, PEOPLE.editor);
  await editor.goto(`/projects/${projectId}`);
  await editor.getByRole("button", { name: "Upload video" }).click();
  await editor.getByTestId("file-input").setInputFiles(join(FIXTURES, "reel-v1.mp4"));
  await editor.getByRole("dialog").getByRole("button", { name: "Upload", exact: true }).click();
  await expect(editor.getByText("Version 1 uploaded")).toBeVisible({ timeout: 60_000 });
  await editor.getByRole("button", { name: "Done" }).click();

  // ---- Steps 5–6: the reviewer, in another session, opens the project and plays the video.
  const reviewer = await signIn(browser, PEOPLE.reviewer);
  await expect(reviewer.getByText("Uncanned Instagram Reel")).toBeVisible();
  await reviewer.getByText("Uncanned Instagram Reel").click();
  await reviewer.getByRole("link", { name: "Open review" }).click();
  await videoReady(reviewer);
  await reviewer.getByRole("button", { name: "Play (Space)" }).click();
  await expect.poll(async () => (await videoState(reviewer)).time).toBeGreaterThan(0.3);
  expect((await videoState(reviewer)).paused).toBe(false);

  // ---- Step 7: pause at ~12.4 s and comment.
  await pauseAt(reviewer, 12.4);
  await reviewer.getByRole("button", { name: /^Comment at 00:12\.4/ }).click();
  await expect(reviewer.getByTestId("draft-timestamp")).toHaveText(/00:12\.4/);
  await reviewer.getByLabel("Comment", { exact: true }).fill("Move the logo slightly higher.");
  await reviewer.getByRole("button", { name: "Post comment" }).click();
  await expect(reviewer.getByTestId("comment").filter({ hasText: "Move the logo slightly higher." })).toBeVisible();

  // ---- Step 8: another comment at ~18.2 s, this one with a drawing.
  await pauseAt(reviewer, 18.2);
  await reviewer.keyboard.press("c");
  await expect(reviewer.getByTestId("draft-timestamp")).toHaveText(/00:18\.2/);
  await reviewer.getByRole("button", { name: "Draw on frame" }).click();
  await reviewer.getByRole("button", { name: "Box" }).click();
  const layer = reviewer.getByTestId("annotation-layer");
  const box = (await layer.boundingBox())!;
  await reviewer.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await reviewer.mouse.down();
  await reviewer.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await reviewer.mouse.up();
  await reviewer.getByLabel("Comment", { exact: true }).fill("Reduce the orange saturation.");
  await reviewer.getByRole("button", { name: "Post comment" }).click();
  await expect(reviewer.getByTestId("comment").filter({ hasText: "Reduce the orange saturation." })).toBeVisible();

  // ---- Step 9: request changes.
  await reviewer.getByRole("button", { name: "Request changes" }).click();
  await reviewer.getByRole("dialog").getByRole("button", { name: "Request changes" }).click();
  await expect(reviewer.getByText("Changes requested", { exact: true }).first()).toBeVisible();

  // ---- Steps 10–11: the editor sees both timestamps; clicking one seeks there.
  await editor.goto(`/projects/${projectId}`);
  await expect(editor.getByText("Changes requested").first()).toBeVisible();
  await editor.getByRole("link", { name: "Open review" }).click();
  await videoReady(editor);
  const stamps = editor.getByTestId("comment-timestamp");
  await expect(stamps).toHaveCount(2);
  await expect(stamps.nth(0)).toContainText("00:12.400");
  await expect(stamps.nth(1)).toContainText("00:18.200");
  await stamps.nth(0).click();
  await expect.poll(async () => (await videoState(editor)).time).toBeCloseTo(12.4, 1);
  expect((await videoState(editor)).paused).toBe(true);
  // The editor replies, as the brief describes.
  const first = editor.getByTestId("comment").first();
  await first.getByRole("button", { name: "Reply" }).click();
  await first.getByLabel("Reply").fill("Fixed in V2.");
  await first.getByRole("button", { name: "Reply" }).last().click();
  await expect(first.getByText("Fixed in V2.")).toBeVisible();
  const v1Id = editor.url().split("/").pop()!;

  // ---- Step 12: the editor uploads reel-v2.mp4 with notes.
  await editor.goto(`/projects/${projectId}`);
  await editor.getByRole("button", { name: "Upload new version" }).click();
  await editor.getByTestId("file-input").setInputFiles(join(FIXTURES, "reel-v2.mp4"));
  await editor.getByLabel("Version notes").fill("Updated logo and color.");
  await editor.getByRole("dialog").getByRole("button", { name: "Upload", exact: true }).click();
  await expect(editor.getByText("Version 2 uploaded")).toBeVisible({ timeout: 60_000 });
  await editor.getByRole("button", { name: "Done" }).click();

  // ---- Steps 13–15: V1 is intact with its comments; V2 is latest and awaiting review.
  const detail = await (await editor.request.get(`/api/projects/${projectId}`)).json();
  expect(detail.versions.map((v: { version_number: number }) => v.version_number)).toEqual([2, 1]);
  const [v2, v1] = detail.versions;
  expect(v1.id).toBe(v1Id);
  expect(v2.is_latest).toBe(true);
  expect(v2.approval_status).toBe("in_review");
  expect(v2.notes).toBe("Updated logo and color.");
  expect(v1.approval_status).toBe("changes_requested");
  expect(detail.status).toBe("in_review");

  await editor.goto(`/projects/${projectId}/review/${v1.id}`);
  await expect(editor.getByText(/You are viewing V1, an older version/)).toBeVisible();
  await expect(editor.getByTestId("comment-timestamp")).toHaveCount(2);
  const v1Media = await editor.request.get(`/api/versions/${v1.id}/media`, { headers: { Range: "bytes=0-1023" } });
  expect(v1Media.status()).toBe(206);

  // ---- Steps 16–17: the reviewer opens V2 and approves it.
  await reviewer.goto(`/projects/${projectId}`);
  await reviewer.getByRole("link", { name: "Open review" }).click();
  await expect(reviewer).toHaveURL(new RegExp(`/review/${v2.id}$`));
  await videoReady(reviewer);
  await expect(reviewer.getByText("No feedback yet")).toBeVisible();
  await reviewer.getByRole("button", { name: "Approve" }).click();
  await reviewer.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(reviewer.getByRole("button", { name: "Approved" })).toBeDisabled();

  // ---- Step 18: the project shows the approval.
  await reviewer.goto(`/projects/${projectId}`);
  await expect(reviewer.getByRole("heading", { name: "Uncanned Instagram Reel" })).toBeVisible();
  await expect(reviewer.getByText("Approved").first()).toBeVisible();
  const approvals = await (await reviewer.request.get(`/api/projects/${projectId}/approvals`)).json();
  expect(approvals.map((a: { version_number: number; decision: string }) => [a.version_number, a.decision])).toEqual([
    [2, "approved"],
    [1, "changes_requested"],
  ]);
  expect(approvals[0].reviewer.email).toBe(PEOPLE.reviewer.email);

  // ---- Step 21: guessing IDs gets nowhere.
  const anon = await request.newContext({ baseURL });
  expect((await anon.get(`/api/versions/${v1.id}/media`)).status()).toBe(401);
  expect((await anon.get(`/api/projects/${projectId}`)).status()).toBe(401);
  const outsider = await request.newContext({ baseURL });
  const login = await outsider.post("/api/auth/login", {
    data: { email: PEOPLE.outsider.email, password: PEOPLE.outsider.password },
  });
  expect(login.status()).toBe(200);
  for (const url of [
    `/api/projects/${projectId}`,
    `/api/versions/${v1.id}/media`,
    `/api/versions/${v2.id}/download`,
    `/api/versions/${v1.id}/comments`,
  ]) {
    expect((await outsider.get(url)).status(), url).toBe(404);
  }
  expect((await (await outsider.get("/api/projects")).json()).items).toEqual([]);

  saveState({
    projectId,
    v1Id: v1.id,
    v2Id: v2.id,
    v1Size: statSync(join(FIXTURES, "reel-v1.mp4")).size,
    v2Size: statSync(join(FIXTURES, "reel-v2.mp4")).size,
  });
});
