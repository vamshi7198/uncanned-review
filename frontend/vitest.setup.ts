import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom has no media pipeline: model just enough of HTMLMediaElement for the
// player's seek/pause/play behaviour to be observable.
type MediaState = { _t?: number; _paused?: boolean };
Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
  configurable: true,
  get(this: MediaState) {
    return this._t ?? 0;
  },
  set(this: HTMLMediaElement & MediaState, v: number) {
    this._t = v;
    this.dispatchEvent(new Event("seeked"));
  },
});
Object.defineProperty(HTMLMediaElement.prototype, "duration", {
  configurable: true,
  get: () => 20,
});
Object.defineProperty(HTMLMediaElement.prototype, "paused", {
  configurable: true,
  get(this: MediaState) {
    return this._paused ?? true;
  },
});
HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement & MediaState) {
  this._paused = true;
  this.dispatchEvent(new Event("pause"));
};
HTMLMediaElement.prototype.play = function (this: HTMLMediaElement & MediaState) {
  this._paused = false;
  this.dispatchEvent(new Event("play"));
  return Promise.resolve();
};
HTMLMediaElement.prototype.load = () => {};

// jsdom lacks the modal dialog API.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute("open");
};

Element.prototype.scrollIntoView = () => {};
