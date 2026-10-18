// Crop-rectangle maths for the Edit Image tool: aspect presets, dragging a handle, moving, nudging
// with the keyboard. Pure and in whole pixels of the picture being cropped, so it is tested on its own
// and behaves the same for a mouse, a finger or the arrow keys.

import type { Rect } from "./ops.ts";

export interface Bounds {
  w: number;
  h: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface AspectPreset {
  id: string;
  label: string;
  // Width / height; null means free.
  ratio: number | null;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "1:1", label: "1:1 (square)", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "2:3", label: "2:3", ratio: 2 / 3 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "35:45", label: "Passport 35:45", ratio: 35 / 45 },
];

export function presetById(id: string): AspectPreset | undefined {
  return ASPECT_PRESETS.find((p) => p.id === id);
}

export const MIN_CROP = 16;

function minFor(bounds: Bounds, min: number): number {
  return Math.max(1, Math.min(min, bounds.w, bounds.h));
}

// The largest rectangle of the given shape that fits inside `inside`, centred in it. Whole pixels; the
// shape is exact to within a pixel.
export function fitAspect(inside: Rect, ratio: number, bounds: Bounds): Rect {
  let w = inside.w;
  let h = Math.round(w / ratio);
  if (h > inside.h) {
    h = inside.h;
    w = Math.round(h * ratio);
  }
  w = Math.max(1, Math.min(w, bounds.w));
  h = Math.max(1, Math.min(h, bounds.h));
  const x = Math.min(Math.max(0, Math.round(inside.x + (inside.w - w) / 2)), bounds.w - w);
  const y = Math.min(Math.max(0, Math.round(inside.y + (inside.h - h) / 2)), bounds.h - h);
  return { x, y, w, h };
}

export function moveRect(rect: Rect, dx: number, dy: number, bounds: Bounds): Rect {
  const x = Math.min(Math.max(0, Math.round(rect.x + dx)), bounds.w - rect.w);
  const y = Math.min(Math.max(0, Math.round(rect.y + dy)), bounds.h - rect.h);
  return { ...rect, x, y };
}

// Drags `handle` by (dx, dy) pixels. The opposite side (or corner) stays put. With `ratio` set the shape
// is kept; without it the sides move freely. Never leaves the picture, never gets smaller than `min`.
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, bounds: Bounds, ratio: number | null, min: number = MIN_CROP): Rect {
  const m = minFor(bounds, min);
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;

  if (ratio === null) {
    if (handle.includes("w")) left = Math.min(Math.max(0, left + dx), right - m);
    if (handle.includes("e")) right = Math.max(Math.min(bounds.w, right + dx), left + m);
    if (handle.includes("n")) top = Math.min(Math.max(0, top + dy), bottom - m);
    if (handle.includes("s")) bottom = Math.max(Math.min(bounds.h, bottom + dy), top + m);
    return roundRect(left, top, right, bottom);
  }

  const corner = handle.length === 2;
  if (corner) {
    // The opposite corner is the anchor. Width follows the pointer; height follows the shape.
    const anchorX = handle.includes("w") ? right : left;
    const anchorY = handle.includes("n") ? bottom : top;
    const dirX = handle.includes("w") ? -1 : 1;
    const dirY = handle.includes("n") ? -1 : 1;
    const room = { w: dirX < 0 ? anchorX : bounds.w - anchorX, h: dirY < 0 ? anchorY : bounds.h - anchorY };
    // Pointer-driven size from either axis, whichever the pointer moved further along the shape.
    const wantW = rect.w + dirX * dx;
    const wantH = rect.h + dirY * dy;
    let w = Math.max(wantW, wantH * ratio);
    const maxW = Math.min(room.w, room.h * ratio);
    const minW = Math.max(m, m * ratio);
    w = Math.min(Math.max(w, minW), Math.max(maxW, 1));
    const h = w / ratio;
    const nx = dirX < 0 ? anchorX - w : anchorX;
    const ny = dirY < 0 ? anchorY - h : anchorY;
    return roundRect(nx, ny, nx + w, ny + h);
  }

  // An edge handle: that side moves; the other axis grows or shrinks around the middle to keep the shape.
  const horizontal = handle === "e" || handle === "w";
  if (horizontal) {
    const anchorX = handle === "w" ? right : left;
    const dir = handle === "w" ? -1 : 1;
    const midY = (top + bottom) / 2;
    const roomW = dir < 0 ? anchorX : bounds.w - anchorX;
    const roomH = 2 * Math.min(midY, bounds.h - midY);
    const maxW = Math.min(roomW, roomH * ratio);
    const minW = Math.max(m, m * ratio);
    const w = Math.min(Math.max(rect.w + dir * dx, minW), Math.max(maxW, 1));
    const h = w / ratio;
    const nx = dir < 0 ? anchorX - w : anchorX;
    return roundRect(nx, midY - h / 2, nx + w, midY + h / 2);
  }
  const anchorY = handle === "n" ? bottom : top;
  const dir = handle === "n" ? -1 : 1;
  const midX = (left + right) / 2;
  const roomH = dir < 0 ? anchorY : bounds.h - anchorY;
  const roomW = 2 * Math.min(midX, bounds.w - midX);
  const maxH = Math.min(roomH, roomW / ratio);
  const minH = Math.max(m, m / ratio);
  const h = Math.min(Math.max(rect.h + dir * dy, minH), Math.max(maxH, 1));
  const w = h * ratio;
  const ny = dir < 0 ? anchorY - h : anchorY;
  return roundRect(midX - w / 2, ny, midX + w / 2, ny + h);
}

function roundRect(left: number, top: number, right: number, bottom: number): Rect {
  const x = Math.round(left);
  const y = Math.round(top);
  return { x, y, w: Math.max(1, Math.round(right) - x), h: Math.max(1, Math.round(bottom) - y) };
}

// Keeps an edited rectangle (typed numbers, a preset) inside the picture. With a shape set, a typed
// width or height makes the other side follow.
export function normalizeRect(rect: Rect, bounds: Bounds, ratio: number | null, changed?: "w" | "h"): Rect {
  let w = Math.min(Math.max(1, Math.round(rect.w)), bounds.w);
  let h = Math.min(Math.max(1, Math.round(rect.h)), bounds.h);
  if (ratio !== null && changed) {
    if (changed === "w") h = Math.round(w / ratio);
    else w = Math.round(h * ratio);
    if (w > bounds.w) {
      w = bounds.w;
      h = Math.round(w / ratio);
    }
    if (h > bounds.h) {
      h = bounds.h;
      w = Math.round(h * ratio);
    }
    w = Math.max(1, Math.min(w, bounds.w));
    h = Math.max(1, Math.min(h, bounds.h));
  }
  const x = Math.min(Math.max(0, Math.round(rect.x)), bounds.w - w);
  const y = Math.min(Math.max(0, Math.round(rect.y)), bounds.h - h);
  return { x, y, w, h };
}

// How far one arrow key press moves an edge: about 1% of the long side, 10x with Shift, at least 1 px.
export function nudgeStep(bounds: Bounds, shift: boolean): number {
  const base = Math.max(1, Math.round(Math.max(bounds.w, bounds.h) / 200));
  return shift ? base * 10 : base;
}
