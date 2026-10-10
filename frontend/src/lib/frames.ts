/**
 * Frame and geometry helpers for the player.
 *
 * Browsers expose only a time (`currentTime`), not a frame index, so frame
 * stepping is computed from the nominal frame rate the server measured with
 * ffprobe. For constant-frame-rate video this lands on the intended frame;
 * for variable-frame-rate video it is approximate, and the UI says so.
 */

/** Used only when the frame rate is unknown; the UI flags the step as approximate. */
export const FALLBACK_FPS = 30;

/** Seek a hair past the frame boundary so rounding never shows the previous frame. */
const EPSILON_S = 0.0001;

export function frameIndex(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function stepTarget(
  currentSeconds: number,
  fps: number,
  direction: 1 | -1,
  durationSeconds: number,
): number {
  const next = frameIndex(currentSeconds, fps) + direction;
  const t = Math.max(0, next / fps + EPSILON_S);
  return Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.min(t, Math.max(0, durationSeconds - 1 / fps / 2))
    : t;
}

export function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the picture actually sits inside a box with `object-fit: contain`.
 * Annotations are drawn relative to this rect, not the letterboxed box, so a
 * mark stays on the same spot of the picture at any player size.
 */
export function containRect(
  boxWidth: number,
  boxHeight: number,
  videoWidth: number,
  videoHeight: number,
): Rect {
  if (!boxWidth || !boxHeight || !videoWidth || !videoHeight) {
    return { left: 0, top: 0, width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height };
}

/** Is the player close enough to a comment's time to show its drawing? */
export function atTimestamp(currentMs: number, targetMs: number, fps: number | null): boolean {
  const tolerance = Math.max(40, 1000 / (fps ?? FALLBACK_FPS));
  return Math.abs(currentMs - targetMs) <= tolerance;
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
