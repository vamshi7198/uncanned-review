"use client";

import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";
import { formatTimecode } from "@/lib/format";
import { FALLBACK_FPS, containRect, stepTarget, toMs, type Rect } from "@/lib/frames";

export interface Marker {
  id: string;
  ms: number;
  resolved: boolean;
  label: string;
}

export interface PlayerHandle {
  seek: (ms: number) => void;
  pause: () => void;
  togglePlay: () => void;
  currentMs: () => number;
  stepFrame: (dir: 1 | -1) => void;
  nudge: (seconds: number) => void;
  changeVolume: (delta: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  isPlaying: () => boolean;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

export const VideoPlayer = forwardRef<
  PlayerHandle,
  {
    src: string;
    fps: number | null;
    variableFrameRate: boolean;
    durationHintMs: number | null;
    markers: Marker[];
    selectedId: string | null;
    onMarkerClick: (id: string) => void;
    onTime: (ms: number) => void;
    onPlayingChange?: (playing: boolean) => void;
    overlay?: ReactNode;
    playbackWarning?: string | null;
    downloadUrl: string;
  }
>(function VideoPlayer(
  {
    src,
    fps,
    variableFrameRate,
    durationHintMs,
    markers,
    selectedId,
    onMarkerClick,
    onTime,
    onPlayingChange,
    overlay,
    playbackWarning,
    downloadUrl,
  },
  ref,
) {
  const video = useRef<HTMLVideoElement>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(durationHintMs ?? 0);
  const [bufferedMs, setBufferedMs] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const lastReported = useRef(-1);

  const effectiveFps = fps ?? FALLBACK_FPS;

  const report = useCallback(
    (ms: number, force = false) => {
      setTimeMs(ms);
      if (force || Math.abs(ms - lastReported.current) >= 100) {
        lastReported.current = ms;
        onTime(ms);
      }
    },
    [onTime],
  );

  // Smooth playhead while playing; exact value on pause/seek.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) report(toMs(v.currentTime));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, report]);

  // Keep the overlay on the picture, not the letterbox.
  const measure = useCallback(() => {
    const box = frameBox.current;
    const v = video.current;
    if (!box || !v) return;
    setRect(containRect(box.clientWidth, box.clientHeight, v.videoWidth, v.videoHeight));
  }, []);

  useEffect(() => {
    const box = frameBox.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const h = () => {
      setFullscreen(document.fullscreenElement === root.current);
      requestAnimationFrame(measure);
    };
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, [measure]);

  const seek = useCallback(
    (ms: number) => {
      const v = video.current;
      if (!v) return;
      const max = Number.isFinite(v.duration) ? v.duration * 1000 : Infinity;
      const target = Math.max(0, Math.min(ms, max));
      v.currentTime = target / 1000;
      report(Math.round(target), true);
    },
    [report],
  );

  const api: PlayerHandle = {
    seek,
    pause: () => video.current?.pause(),
    togglePlay: () => {
      const v = video.current;
      if (!v) return;
      if (v.paused || v.ended) void v.play().catch(() => {});
      else v.pause();
    },
    currentMs: () => toMs(video.current?.currentTime ?? 0),
    stepFrame: (dir) => {
      const v = video.current;
      if (!v) return;
      v.pause();
      v.currentTime = stepTarget(v.currentTime, effectiveFps, dir, v.duration);
      report(toMs(v.currentTime), true);
    },
    nudge: (s) => {
      const v = video.current;
      if (v) seek(v.currentTime * 1000 + s * 1000);
    },
    changeVolume: (d) => {
      const v = video.current;
      if (!v) return;
      v.volume = Math.max(0, Math.min(1, +(v.volume + d).toFixed(2)));
      if (v.volume > 0) v.muted = false;
    },
    toggleMute: () => {
      const v = video.current;
      if (v) v.muted = !v.muted;
    },
    toggleFullscreen: () => {
      const el = root.current;
      if (!el) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el.requestFullscreen?.().catch(() => {});
    },
    isPlaying: () => !!video.current && !video.current.paused,
  };
  useImperativeHandle(ref, () => api);

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  const frameNote = !fps
    ? "Frame rate unknown — frame steps are approximate (1/30 s)."
    : variableFrameRate
      ? `Variable frame rate (~${fps.toFixed(2)} fps) — frame steps are approximate.`
      : `${+fps.toFixed(3)} fps`;

  return (
    <div
      ref={root}
      className={cn("flex min-h-0 flex-col bg-black", fullscreen ? "h-full w-full" : "h-full")}
      data-testid="player"
    >
      <div ref={frameBox} className="relative min-h-0 flex-1">
        <video
          ref={video}
          src={src}
          className="absolute inset-0 size-full object-contain"
          preload="metadata"
          playsInline
          onClick={() => api.togglePlay()}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration)) setDurationMs(toMs(v.duration));
            v.playbackRate = speed;
            measure();
          }}
          onPlay={() => {
            setPlaying(true);
            onPlayingChange?.(true);
          }}
          onPause={(e) => {
            setPlaying(false);
            onPlayingChange?.(false);
            report(toMs(e.currentTarget.currentTime), true);
          }}
          onSeeked={(e) => report(toMs(e.currentTarget.currentTime), true)}
          onTimeUpdate={(e) => {
            if (!playing) report(toMs(e.currentTarget.currentTime));
          }}
          onProgress={(e) => {
            const b = e.currentTarget.buffered;
            if (b.length) setBufferedMs(toMs(b.end(b.length - 1)));
          }}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onVolumeChange={(e) => {
            setVolume(e.currentTarget.volume);
            setMuted(e.currentTarget.muted);
          }}
          onError={() =>
            setError(
              playbackWarning ??
                "This browser cannot play this video. Download the original to review it, or ask the editor to export H.264 MP4.",
            )
          }
          data-testid="video"
        />
        {rect && overlay ? (
          <div
            className="pointer-events-none absolute"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          >
            {/* The drawing layer opts back into pointer events while drawing. */}
            <div className="relative size-full">{overlay}</div>
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center">
            <div className="max-w-md space-y-3">
              <p className="text-sm text-fg">{error}</p>
              <a href={downloadUrl} className="inline-block text-sm text-accent underline underline-offset-2">
                Download original
              </a>
            </div>
          </div>
        ) : null}
        {waiting && playing ? (
          <div className="pointer-events-none absolute top-3 right-3 rounded bg-black/70 px-2 py-1 text-xs text-white">
            Buffering…
          </div>
        ) : null}
      </div>

      <Timeline
        durationMs={durationMs}
        timeMs={timeMs}
        bufferedMs={bufferedMs}
        markers={markers}
        selectedId={selectedId}
        onSeek={seek}
        onMarkerClick={onMarkerClick}
      />

      <div className="flex flex-wrap items-center gap-1 border-t border-white/5 bg-[#0b0c0d] px-2 py-1.5 text-white sm:gap-2 sm:px-3">
        <CtlButton label={playing ? "Pause (Space)" : "Play (Space)"} onClick={api.togglePlay}>
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </CtlButton>
        <CtlButton label="Previous frame (,)" onClick={() => api.stepFrame(-1)}>
          <ChevronLeft className="size-5" />
        </CtlButton>
        <CtlButton label="Next frame (.)" onClick={() => api.stepFrame(1)}>
          <ChevronRight className="size-5" />
        </CtlButton>
        <span className="tabular px-1 font-mono text-xs text-white/90 sm:text-sm" data-testid="timecode">
          {formatTimecode(timeMs)}
          <span className="text-white/40"> / {formatTimecode(durationMs)}</span>
        </span>
        <span className="hidden text-[11px] text-white/40 lg:inline" title={frameNote}>
          {frameNote}
        </span>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <label className="sr-only" htmlFor="speed">
            Playback speed
          </label>
          <select
            id="speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="h-8 rounded-md border border-white/10 bg-white/5 px-1.5 text-xs text-white"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s} className="bg-surface">
                {s}×
              </option>
            ))}
          </select>
          <CtlButton label={muted ? "Unmute (M)" : "Mute (M)"} onClick={api.toggleMute}>
            {muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </CtlButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = video.current;
              if (!v) return;
              v.volume = Number(e.target.value);
              v.muted = v.volume === 0;
            }}
            aria-label="Volume"
            className="hidden w-20 accent-[var(--color-accent)] sm:block"
          />
          <CtlButton label={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"} onClick={api.toggleFullscreen}>
            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </CtlButton>
        </div>
      </div>
    </div>
  );
});

function CtlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

function Timeline({
  durationMs,
  timeMs,
  bufferedMs,
  markers,
  selectedId,
  onSeek,
  onMarkerClick,
}: {
  durationMs: number;
  timeMs: number;
  bufferedMs: number;
  markers: Marker[];
  selectedId: string | null;
  onSeek: (ms: number) => void;
  onMarkerClick: (id: string) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  const pct = (ms: number) => (durationMs > 0 ? Math.min(100, (ms / durationMs) * 100) : 0);

  function msAt(clientX: number) {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * durationMs);
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (!durationMs) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(msAt(e.clientX));
  }

  return (
    <div className="bg-[#0b0c0d] px-3 pt-3 pb-1">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(timeMs / 1000)}
        aria-valuetext={formatTimecode(timeMs)}
        className="group relative h-5 cursor-pointer touch-none"
        onPointerDown={down}
        onPointerMove={(e) => {
          if (!durationMs) return;
          const ms = msAt(e.clientX);
          setHover(ms);
          if (dragging.current) onSeek(ms);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
        data-testid="timeline"
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15 transition-[height] group-hover:h-1.5">
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/20" style={{ width: `${pct(bufferedMs)}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct(timeMs)}%` }} />
        </div>
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
          style={{ left: `${pct(timeMs)}%` }}
        />
        {hover != null ? (
          <div
            className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[10px] text-white"
            style={{ left: `${pct(hover)}%` }}
          >
            {formatTimecode(hover)}
          </div>
        ) : null}
      </div>
      {/* Comment markers sit in their own row so they stay clickable. */}
      <div className="relative h-4" aria-label="Comment markers">
        {durationMs > 0
          ? markers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onMarkerClick(m.id)}
                title={`${formatTimecode(m.ms)} — ${m.label}`}
                aria-label={`Go to comment at ${formatTimecode(m.ms)}`}
                className={cn(
                  "absolute top-0.5 h-3 w-1.5 -translate-x-1/2 rounded-sm transition-transform hover:scale-125",
                  m.resolved ? "bg-white/30" : "bg-accent",
                  selectedId === m.id && "scale-125 ring-2 ring-white",
                )}
                style={{ left: `${pct(m.ms)}%` }}
              />
            ))
          : null}
      </div>
    </div>
  );
}
