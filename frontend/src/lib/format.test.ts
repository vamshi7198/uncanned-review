import { describe, expect, it } from "vitest";

import { formatBytes, formatDuration, formatRelative, formatTimecode } from "./format";

describe("formatTimecode", () => {
  it("keeps milliseconds", () => {
    expect(formatTimecode(12400)).toBe("00:12.400");
    expect(formatTimecode(18200)).toBe("00:18.200");
    expect(formatTimecode(0)).toBe("00:00.000");
  });
  it("handles minutes and hours", () => {
    expect(formatTimecode(65_007)).toBe("01:05.007");
    expect(formatTimecode(3_725_123)).toBe("1:02:05.123");
  });
  it("clamps negatives", () => {
    expect(formatTimecode(-5)).toBe("00:00.000");
  });
});

describe("other formatters", () => {
  it("formats duration", () => {
    expect(formatDuration(42_000)).toBe("0:42");
    expect(formatDuration(null)).toBe("—");
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(250 * 1024 ** 2)).toBe("250 MB");
  });
  it("formats relative time", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(formatRelative("2026-10-10T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-10-10T11:30:00Z", now)).toBe("30 min ago");
    expect(formatRelative("2026-10-09T11:00:00Z", now)).toBe("yesterday");
  });
});
