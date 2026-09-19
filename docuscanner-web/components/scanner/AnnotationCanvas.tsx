"use client";

// The editing surface: the page image, the annotations drawn over it, and the
// pointer handling that creates, selects, moves and resizes them. It never owns
// the annotation list -- it reports changes upward (`onPreview` while a gesture
// is in progress, `onCommit` when it ends) so the parent can keep undo/redo.
// Mouse, pen and touch all go through pointer events; the surface disables
// browser touch scrolling so a finger drag draws or moves instead of scrolling.

import { useEffect, useRef, useState } from "react";
import {
  clamp,
  createStamp,
  createText,
  FONT_STACK,
  isResizable,
  ptToSize,
  resizeAnnotation,
  TEXT_LINE_HEIGHT,
  todayLabel,
  translateAnnotation,
  MIN_BOX,
  newAnnotationId,
  type Annotation,
  type AnnotationTool,
  type HighlightAnnotation,
  type InkAnnotation,
  type TextAnnotation,
  type TextStyle,
} from "@/utils/scanner/annotations";
import { annotationBounds, findAnnotationAt } from "@/utils/scanner/annotationRender";
import type { ScannerPage } from "@/utils/scanner/page";
import { useAnnotationCanvas } from "./useAnnotationCanvas";

export interface AnnotationDefaults {
  color: string;
  highlightColor: string;
  penWidth: number;
  text: TextStyle;
}

// Capturing the pointer keeps a drag going when the finger or cursor leaves the
// page, but it can throw if the browser no longer considers that pointer active
// (a lifted pen, an interrupted touch). The gesture still works without it.
function tryCapture(element: Element | null, pointerId: number): void {
  try {
    element?.setPointerCapture(pointerId);
  } catch {
    // Not fatal; see above.
  }
}

// How close (in on-screen pixels) a finger or cursor has to be to grab a mark.
const HIT_TOLERANCE_PX = 14;
// Pen samples closer together than this (as a fraction of the page) are skipped.
const MIN_INK_STEP = 0.0015;

type Drag =
  | { kind: "move"; id: string; startX: number; startY: number; original: Annotation; moved: boolean }
  | { kind: "resize"; id: string; startX: number; startY: number; original: Annotation }
  | { kind: "ink"; id: string }
  | { kind: "highlight"; id: string; originX: number; originY: number };

export function AnnotationCanvas({
  page,
  annotations,
  tool,
  selectedId,
  editingId,
  defaults,
  onSelect,
  onStartEditing,
  onFinishEditing,
  onPreview,
  onCommit,
  onDiscardPreview,
  onPlaced,
}: {
  page: ScannerPage;
  annotations: Annotation[];
  tool: AnnotationTool;
  selectedId: string | null;
  editingId: string | null;
  defaults: AnnotationDefaults;
  onSelect: (id: string | null) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: () => void;
  onPreview: (next: Annotation[]) => void;
  onCommit: (next: Annotation[]) => void;
  onDiscardPreview: () => void;
  // A one-shot mark (text, date, check, cross) was just placed.
  onPlaced: (kind: "text" | "date" | "check" | "cross") => void;
}) {
  const pageW = page.processedWidth;
  const pageH = page.processedHeight;

  const frameRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const ignoreClickRef = useRef(false);
  const [frameWidth, setFrameWidth] = useState(0);

  useAnnotationCanvas(canvasRef, annotations, pageW, pageH, editingId);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver((entries) => setFrameWidth(entries[0].contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const editing = annotations.find((a): a is TextAnnotation => a.id === editingId && a.type === "text") ?? null;

  // Keep the on-screen text box exactly as tall as its text, and focus it when
  // editing starts.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing?.text, editing?.w, editing?.size, frameWidth]);

  useEffect(() => {
    if (editingId) textareaRef.current?.focus();
  }, [editingId]);

  function pointFrom(e: React.PointerEvent): { x: number; y: number } | null {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  // On-screen tolerance expressed in the page's reference pixels.
  function toleranceRef(): number {
    return frameWidth > 0 ? (HIT_TOLERANCE_PX * pageW) / frameWidth : HIT_TOLERANCE_PX;
  }

  function hitAt(x: number, y: number): Annotation | null {
    return findAnnotationAt(annotations, x, y, pageW, pageH, toleranceRef());
  }

  function replace(next: Annotation): Annotation[] {
    return annotations.map((a) => (a.id === next.id ? next : a));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = pointFrom(e);
    if (!p) return;

    // Tapping anywhere while typing just finishes the text (and the click that
    // follows must not start a new box).
    if (editingId) {
      ignoreClickRef.current = true;
      onFinishEditing();
      return;
    }

    tryCapture(e.currentTarget, e.pointerId);

    switch (tool) {
      case "select": {
        const hit = hitAt(p.x, p.y);
        onSelect(hit?.id ?? null);
        if (hit) dragRef.current = { kind: "move", id: hit.id, startX: p.x, startY: p.y, original: hit, moved: false };
        return;
      }
      case "text":
        // Handled on click, not here: the text box has to take keyboard focus,
        // and browsers (iOS especially) only allow that from a completed tap,
        // and would otherwise steal the focus straight back on mouse-down.
        return;
      case "date": {
        const created = createText(Math.min(p.x, 0.75), p.y, todayLabel(), defaults.text);
        onCommit([...annotations, created]);
        onSelect(created.id);
        onPlaced("date");
        return;
      }
      case "check":
      case "cross": {
        const stamp = createStamp(tool, p.x, p.y, defaults.color, pageW, pageH);
        onCommit([...annotations, stamp]);
        onSelect(stamp.id);
        onPlaced(tool);
        return;
      }
      case "draw": {
        const ink: InkAnnotation = {
          id: newAnnotationId(),
          type: "ink",
          points: [[p.x, p.y]],
          color: defaults.color,
          width: defaults.penWidth,
        };
        dragRef.current = { kind: "ink", id: ink.id };
        onPreview([...annotations, ink]);
        return;
      }
      case "highlight": {
        const highlight: HighlightAnnotation = {
          id: newAnnotationId(),
          type: "highlight",
          x: p.x,
          y: p.y,
          w: 0,
          h: 0,
          color: defaults.highlightColor,
        };
        dragRef.current = { kind: "highlight", id: highlight.id, originX: p.x, originY: p.y };
        onPreview([...annotations, highlight]);
        return;
      }
      case "signature":
        // Placed from the signature dialog, not by tapping the page.
        return;
    }
  }

  function handleResizeDown(e: React.PointerEvent<HTMLButtonElement>, annotation: Annotation) {
    e.stopPropagation();
    e.preventDefault();
    const p = pointFrom(e);
    if (!p) return;
    // Capture on the layer that owns the move/up handlers: captured events
    // bubble up from the capturing element, never down to a child.
    tryCapture(surfaceRef.current, e.pointerId);
    dragRef.current = { kind: "resize", id: annotation.id, startX: p.x, startY: p.y, original: annotation };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = pointFrom(e);
    if (!p) return;

    if (drag.kind === "move") {
      let dx = p.x - drag.startX;
      let dy = p.y - drag.startY;
      // A tap shouldn't count as a move; wait for a few pixels of travel.
      if (!drag.moved && Math.hypot(dx * pageW, dy * pageH) < toleranceRef() * 0.35) return;
      drag.moved = true;
      // Keep the whole mark on the page.
      const b = annotationBounds(drag.original, pageW, pageH);
      dx = clamp(dx, -b.x, Math.max(-b.x, 1 - (b.x + b.w)));
      dy = clamp(dy, -b.y, Math.max(-b.y, 1 - (b.y + b.h)));
      onPreview(replace(translateAnnotation(drag.original, dx, dy)));
    } else if (drag.kind === "resize") {
      onPreview(replace(resizeAnnotation(drag.original, p.x - drag.startX, p.y - drag.startY, pageW, pageH)));
    } else if (drag.kind === "ink") {
      const ink = annotations.find((a): a is InkAnnotation => a.id === drag.id && a.type === "ink");
      if (!ink) return;
      const last = ink.points[ink.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) < MIN_INK_STEP) return;
      onPreview(replace({ ...ink, points: [...ink.points, [p.x, p.y]] }));
    } else {
      const x = Math.min(p.x, drag.originX);
      const y = Math.min(p.y, drag.originY);
      const highlight = annotations.find((a): a is HighlightAnnotation => a.id === drag.id && a.type === "highlight");
      if (!highlight) return;
      onPreview(replace({ ...highlight, x, y, w: Math.abs(p.x - drag.originX), h: Math.abs(p.y - drag.originY) }));
    }
  }

  function endDrag(cancelled: boolean) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (cancelled) {
      onDiscardPreview();
      return;
    }
    if (drag.kind === "move" && !drag.moved) {
      onDiscardPreview();
    } else if (drag.kind === "highlight") {
      // A click without a drag isn't a highlight.
      const h = annotations.find((a) => a.id === drag.id);
      if (h?.type === "highlight" && h.w > MIN_BOX / 2 && h.h > MIN_BOX / 4) onCommit(annotations);
      else onDiscardPreview();
    } else {
      onCommit(annotations);
    }
  }

  // Text boxes are created on click (a completed tap), so the box can take
  // keyboard focus reliably on every browser.
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (tool !== "text" || editingId) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);

    const hit = hitAt(x, y);
    if (hit?.type === "text") {
      onSelect(hit.id);
      onStartEditing(hit.id);
      return;
    }
    // The tap is where the text's first line starts, nudged up so the caret
    // lands under the finger rather than below it.
    const halfLine = (ptToSize(defaults.text.pt) * pageW * TEXT_LINE_HEIGHT * 0.5) / pageH;
    const created = createText(Math.min(x, 0.9), clamp(y - halfLine, 0, 0.95), "", defaults.text);
    onPreview([...annotations, created]);
    onSelect(created.id);
    onStartEditing(created.id);
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (tool !== "select") return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const hit = hitAt((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    if (hit?.type === "text") {
      onSelect(hit.id);
      onStartEditing(hit.id);
    }
  }

  const selected = annotations.find((a) => a.id === selectedId) ?? null;
  const selectedBounds = selected && selected.id !== editingId ? annotationBounds(selected, pageW, pageH) : null;
  const cursor = tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

  return (
    <div
      ref={frameRef}
      className="relative select-none overflow-hidden bg-white shadow-md"
      style={{ aspectRatio: `${pageW} / ${pageH}`, width: "100%" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
      <img
        src={page.processedDataUrl}
        alt="Page being annotated"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />

      <div
        ref={surfaceRef}
        role="application"
        aria-label="Page annotation area"
        className="absolute inset-0"
        style={{ touchAction: "none", cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => endDrag(false)}
        onPointerCancel={() => endDrag(true)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {selectedBounds && selected && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute border border-dashed border-blue-600"
              style={{
                left: `${selectedBounds.x * 100}%`,
                top: `${selectedBounds.y * 100}%`,
                width: `${selectedBounds.w * 100}%`,
                height: `${selectedBounds.h * 100}%`,
              }}
            />
            {isResizable(selected) && (
              <button
                type="button"
                aria-label="Resize"
                onPointerDown={(e) => handleResizeDown(e, selected)}
                className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize items-center justify-center"
                style={{
                  left: `${(selectedBounds.x + selectedBounds.w) * 100}%`,
                  top: `${(selectedBounds.y + selectedBounds.h) * 100}%`,
                  touchAction: "none",
                }}
              >
                <span className="h-4 w-4 rounded-full border-2 border-blue-600 bg-white shadow" />
              </button>
            )}
          </>
        )}

        {editing && (
          <textarea
            ref={textareaRef}
            value={editing.text}
            aria-label="Text"
            rows={1}
            spellCheck={false}
            onChange={(e) => onPreview(annotations.map((a) => (a.id === editing.id ? { ...editing, text: e.target.value } : a)))}
            onBlur={onFinishEditing}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-1 outline-dashed outline-blue-600"
            style={{
              left: `${editing.x * 100}%`,
              top: `${editing.y * 100}%`,
              width: `${editing.w * 100}%`,
              fontSize: `${editing.size * frameWidth}px`,
              lineHeight: TEXT_LINE_HEIGHT,
              color: editing.color,
              fontWeight: editing.bold ? "bold" : "normal",
              fontStyle: editing.italic ? "italic" : "normal",
              fontFamily: FONT_STACK,
              touchAction: "auto",
            }}
          />
        )}
      </div>
    </div>
  );
}
