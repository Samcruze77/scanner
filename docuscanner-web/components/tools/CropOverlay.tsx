"use client";

// The draggable crop box for the Edit Image tool. It sits over the preview and works in the picture's own
// pixels (`bounds`), so what you drag is exactly what is cropped. Mouse, finger and pen all use pointer
// events; every handle and the box itself can also be moved with the arrow keys (Shift = bigger steps).

import { useRef } from "react";
import { HANDLES, moveRect, nudgeStep, resizeRect, type Bounds, type Handle } from "@/utils/imageEdit/crop";
import type { Rect } from "@/utils/imageEdit/ops";

const HANDLE_LABEL: Record<Handle, string> = {
  nw: "top left corner",
  n: "top edge",
  ne: "top right corner",
  e: "right edge",
  se: "bottom right corner",
  s: "bottom edge",
  sw: "bottom left corner",
  w: "left edge",
};

const HANDLE_POS: Record<Handle, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
};

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

interface Drag {
  kind: "move" | Handle;
  startX: number;
  startY: number;
  start: Rect;
}

export function CropOverlay({
  rect,
  bounds,
  ratio,
  onChange,
}: {
  rect: Rect;
  bounds: Bounds;
  // Width / height to keep, or null for a free shape.
  ratio: number | null;
  onChange: (rect: Rect) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  // On-screen pixels to picture pixels.
  function scale(): number {
    const box = root.current?.getBoundingClientRect();
    return box && box.width > 0 ? bounds.w / box.width : 1;
  }

  function begin(e: React.PointerEvent, kind: Drag["kind"]) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, startX: e.clientX, startY: e.clientY, start: rect };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const k = scale();
    const dx = (e.clientX - d.startX) * k;
    const dy = (e.clientY - d.startY) * k;
    onChange(d.kind === "move" ? moveRect(d.start, dx, dy, bounds) : resizeRect(d.start, d.kind, dx, dy, bounds, ratio));
  }

  function end(e: React.PointerEvent) {
    if (!drag.current) return;
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  function key(e: React.KeyboardEvent, kind: Drag["kind"]) {
    const dir = ARROWS[e.key];
    if (!dir) return;
    e.preventDefault();
    const step = nudgeStep(bounds, e.shiftKey);
    const dx = dir[0] * step;
    const dy = dir[1] * step;
    onChange(kind === "move" ? moveRect(rect, dx, dy, bounds) : resizeRect(rect, kind, dx, dy, bounds, ratio));
  }

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  return (
    <div ref={root} className="absolute inset-0 touch-none select-none overflow-hidden" data-crop-overlay>
      <div
        className="absolute border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
        style={{ left: pct(rect.x, bounds.w), top: pct(rect.y, bounds.h), width: pct(rect.w, bounds.w), height: pct(rect.h, bounds.h) }}
        data-crop-box
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={`Move the crop area. Now ${rect.w} by ${rect.h} pixels. Use the arrow keys.`}
          className="absolute inset-0 cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onPointerDown={(e) => begin(e, "move")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => key(e, "move")}
          data-crop-move
        />
        {/* Rule-of-thirds guides help with framing and are purely visual. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50">
          <div className="absolute left-1/3 top-0 h-full w-px bg-white" />
          <div className="absolute left-2/3 top-0 h-full w-px bg-white" />
          <div className="absolute left-0 top-1/3 h-px w-full bg-white" />
          <div className="absolute left-0 top-2/3 h-px w-full bg-white" />
        </div>
        {HANDLES.map((h) => (
          <button
            key={h}
            type="button"
            aria-label={`Resize the crop from the ${HANDLE_LABEL[h]}. Use the arrow keys.`}
            data-crop-handle={h}
            className={`absolute h-6 w-6 rounded-full border-2 border-blue-600 bg-white shadow before:absolute before:-inset-3 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${HANDLE_POS[h]}`}
            onPointerDown={(e) => begin(e, h)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(e) => key(e, h)}
          />
        ))}
      </div>
    </div>
  );
}
