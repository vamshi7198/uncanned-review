/**
 * Acceptance steps 19–20: run after `docker compose restart` (and again after
 * the containers are recreated) to prove nothing lived only in memory.
 */
import { expect, test } from "@playwright/test";

import { PEOPLE, loadState, signIn, videoReady } from "./helpers";

test("projects, videos, comments, versions and approvals survive a restart", async ({ browser }) => {
  const s = loadState();
  const page = await signIn(browser, PEOPLE.reviewer);

  const detail = await (await page.request.get(`/api/projects/${s.projectId}`)).json();
  expect(detail.name).toBe("Uncanned Instagram Reel");
  expect(detail.status).toBe("approved");
  expect(detail.versions.map((v: { id: string }) => v.id)).toEqual([s.v2Id, s.v1Id]);

  const comments = await (await page.request.get(`/api/versions/${s.v1Id}/comments`)).json();
  expect(comments.map((c: { timestamp_ms: number; text: string }) => [c.timestamp_ms, c.text])).toEqual([
    [12400, "Move the logo slightly higher."],
    [18200, "Reduce the orange saturation."],
  ]);
  expect(comments[0].replies[0].text).toBe("Fixed in V2.");
  expect(comments[1].annotation.shapes[0].kind).toBe("rect");

  const approvals = await (await page.request.get(`/api/projects/${s.projectId}/approvals`)).json();
  expect(approvals.map((a: { decision: string }) => a.decision)).toEqual(["approved", "changes_requested"]);

  for (const [id, size] of [
    [s.v1Id, s.v1Size],
    [s.v2Id, s.v2Size],
  ] as const) {
    const full = await page.request.get(`/api/versions/${id}/download`);
    expect(full.status()).toBe(200);
    expect((await full.body()).length).toBe(size);
  }

  await page.goto(`/projects/${s.projectId}/review/${s.v1Id}`);
  await videoReady(page);
  await expect(page.getByTestId("comment-timestamp")).toHaveCount(2);
});
