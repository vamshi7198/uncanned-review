import { describe, expect, it } from "vitest";

import { atTimestamp, containRect, frameIndex, stepTarget } from "./frames";

describe("frame stepping", () => {
  it("steps exactly one frame at the video's own rate", () => {
    // 25 fps: frame 310 is at 12.4 s.
    expect(frameIndex(12.4, 25)).toBe(310);
    expect(frameIndex(stepTarget(12.4, 25, 1, 60), 25)).toBe(311);
    expect(frameIndex(stepTarget(12.4, 25, -1, 60), 25)).toBe(309);
  });

  it("does not assume 30 fps", () => {
    const t24 = stepTarget(1, 24, 1, 60);
    expect(t24).toBeCloseTo(25 / 24, 3);
    const t60 = stepTarget(1, 60, 1, 60);
    expect(t60).toBeCloseTo(61 / 60, 3);
  });

  it("handles NTSC rates without drifting", () => {
    const fps = 30000 / 1001;
    let t = 0;
    for (let i = 0; i < 300; i++) t = stepTarget(t, fps, 1, 600);
    expect(frameIndex(t, fps)).toBe(300);
  });

  it("clamps at both ends", () => {
    expect(stepTarget(0, 25, -1, 10)).toBeGreaterThanOrEqual(0);
    expect(stepTarget(10, 25, 1, 10)).toBeLessThan(10);
  });
});

describe("containRect", () => {
  it("letterboxes a 16:9 video in a square box", () => {
    const r = containRect(1000, 1000, 1920, 1080);
    expect(r.left).toBeCloseTo(0);
    expect(r.top).toBeCloseTo(218.75);
    expect(r.width).toBeCloseTo(1000);
    expect(r.height).toBeCloseTo(562.5);
  });
  it("pillarboxes a vertical reel in a wide box", () => {
    const r = containRect(1600, 900, 1080, 1920);
    expect(r.height).toBe(900);
    expect(r.width).toBeCloseTo(506.25);
    expect(r.left).toBeCloseTo((1600 - 506.25) / 2);
  });
});

describe("atTimestamp", () => {
  it("allows about one frame of tolerance", () => {
    expect(atTimestamp(12_400, 12_400, 25)).toBe(true);
    expect(atTimestamp(12_430, 12_400, 25)).toBe(true);
    expect(atTimestamp(12_500, 12_400, 25)).toBe(false);
  });
});
