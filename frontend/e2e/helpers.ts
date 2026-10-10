import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, type Browser, type Page } from "@playwright/test";

export const FIXTURES = join(__dirname, ".fixtures");
export const STATE_FILE = join(FIXTURES, "state.json");

export const PEOPLE = {
  admin: { name: "Asha Admin", email: "admin@uncanned.example.com", password: "admin-password-123" },
  editor: { name: "Eddie Editor", email: "editor@uncanned.example.com", password: "editor-password-123" },
  reviewer: { name: "Riya Reviewer", email: "reviewer@uncanned.example.com", password: "reviewer-password-123" },
  outsider: { name: "Olly Outsider", email: "outsider@uncanned.example.com", password: "outsider-password-123" },
};

export interface State {
  projectId: string;
  v1Id: string;
  v2Id: string;
  v1Size: number;
  v2Size: number;
}

export function saveState(s: State) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

export function loadState(): State {
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

/** A fresh browser session (separate cookies), signed in. */
export async function signIn(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  return page;
}

export async function videoReady(page: Page) {
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return !!v && v.readyState >= 2 && !v.error;
  });
}

/** Simulates the reviewer scrubbing to a point and pausing there. */
export async function pauseAt(page: Page, seconds: number) {
  await page.evaluate(async (t) => {
    const v = document.querySelector("video")!;
    v.pause();
    await new Promise<void>((resolve) => {
      v.addEventListener("seeked", () => resolve(), { once: true });
      v.currentTime = t;
    });
  }, seconds);
}

export async function videoState(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector("video")!;
    return { time: v.currentTime, paused: v.paused, src: v.currentSrc };
  });
}
