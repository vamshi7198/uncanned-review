"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import { clamp01 } from "@/lib/frames";
import type { Annotation, Point, Shape } from "@/lib/types";

export type Tool = Shape["kind"];

/**
 * SVG overlay sized to the visible picture. Coordinates are 0–1 of the
 * picture, so drawings stay aligned at any player size and in fullscreen.
 *
 * Shapes use a dark outline under a bright stroke so they read on light and
 * dark footage, and each kind has a distinct form (arrowhead, box, line),
 * so meaning never depends on colour alone.
 */
export function AnnotationLayer({
  annotation,
  drawing,
  tool,
  onChange,
}: {
  annotation: Annotation | null;
  drawing: boolean;
  tool: Tool;
  onChange?: (a: Annotation | null) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<Shape | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Draw in pixels (mapped from 0–1) so strokes and arrowheads never distort.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shapes = [...(annotation?.shapes ?? []), ...(live ? [live] : [])];

  function point(e: PointerEvent): Point {
    const r = svg.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }

  function down(e: PointerEvent<SVGSVGElement>) {
    if (!drawing) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setLive({ kind: tool, points: [p, p] });
  }

  function move(e: PointerEvent<SVGSVGElement>) {
    if (!live) return;
    const p = point(e);
    if (live.kind === "freehand") {
      const last = live.points[live.points.length - 1]!;
      // Thin out points so a long scribble stays small.
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return;
      if (live.points.length >= 1500) return;
      setLive({ ...live, points: [...live.points, p] });
    } else {
      setLive({ ...live, points: [live.points[0]!, p] });
    }
  }

  function up() {
    if (!live) return;
    const [a, b] = [live.points[0]!, live.points[live.points.length - 1]!];
    const big = Math.hypot(b.x - a.x, b.y - a.y) > 0.01 || live.points.length > 3;
    if (big) onChange?.({ shapes: [...(annotation?.shapes ?? []), round(live)].slice(-50) });
    setLive(null);
  }

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
      className="absolute inset-0 size-full"
      style={{ cursor: drawing ? "crosshair" : "default", pointerEvents: drawing ? "auto" : "none", touchAction: drawing ? "none" : "auto" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setLive(null)}
      aria-hidden={!drawing}
      role={drawing ? "img" : undefined}
      aria-label={drawing ? "Drawing area" : undefined}
      data-testid="annotation-layer"
    >
      {size.w > 0
        ? shapes.map((s, i) => <ShapeView key={i} shape={s} w={size.w} h={size.h} />)
        : null}
    </svg>
  );
}

function round(s: Shape): Shape {
  return { ...s, points: s.points.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) })) };
}

const STROKE = "#ffd166";

function Stroked({ d }: { d: string }) {
  const common = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g>
      <path d={d} stroke="#000" strokeOpacity={0.65} strokeWidth={6} {...common} />
      <path d={d} stroke={STROKE} strokeWidth={3} {...common} />
    </g>
  );
}

function ShapeView({ shape, w, h }: { shape: Shape; w: number; h: number }) {
  const pts = shape.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  if (shape.kind === "rect") {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    return <Stroked d={`M${x},${y} H${x2} V${y2} H${x} Z`} />;
  }
  if (shape.kind === "arrow") {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.min(18, Math.max(8, Math.hypot(b.x - a.x, b.y - a.y) / 3));
    const head = [angle + Math.PI * 0.82, angle - Math.PI * 0.82]
      .map((t) => `M${b.x},${b.y} L${b.x + len * Math.cos(t)},${b.y + len * Math.sin(t)}`)
      .join(" ");
    return <Stroked d={`M${a.x},${a.y} L${b.x},${b.y} ${head}`} />;
  }
  return <Stroked d={pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")} />;
}
