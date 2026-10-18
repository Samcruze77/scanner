// Draws an edited picture from the ORIGINAL pixels, in one pass, for both the on-screen preview and the
// download. The canvas is injected so the same code runs in the browser and (in tests) in Node.
//
// Crop, rotation and flips are one transform, so the original is resampled at most once (when the size
// changes). A large reduction is done in steps of at most half so detail is averaged rather than skipped.
// Brightness and contrast then run in horizontal strips, so no second full-size copy of the pixels is made.

import { applyAdjustments } from "../scanner/enhance.ts";
import { drawMatrix, geometry, type EditState, type Geometry } from "./ops.ts";

export interface Context2D {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: "low" | "medium" | "high";
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: unknown, ...args: number[]): void;
  getImageData(x: number, y: number, w: number, h: number): ImageData;
  putImageData(data: ImageData, x: number, y: number): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: "2d", options?: unknown): Context2D | null;
}

export type CanvasFactory = (width: number, height: number) => CanvasLike;

export interface RenderOptions {
  // Final size to draw at. Default: the natural final size from the edit state (the full-resolution export).
  width?: number;
  height?: number;
  // Fill colour drawn first (JPEG has no transparency). Null keeps transparency.
  background?: string | null;
  // The drawn `source` may be a smaller copy of the original (a preview proxy). This is the original's
  // size, so the edit state's pixel coordinates still mean the same thing.
  originalWidth?: number;
  originalHeight?: number;
}

const STRIP_ROWS = 256;

function context(canvas: CanvasLike): Context2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  return ctx;
}

// Draws the cropped, rotated and flipped part of `source` at `dw` x `dh` onto a fresh canvas.
function drawOriented(source: { width: number; height: number }, g: Geometry, state: EditState, kx: number, ky: number, dw: number, dh: number, factory: CanvasFactory, background: string | null): CanvasLike {
  const canvas = factory(dw, dh);
  const ctx = context(canvas);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, dw, dh);
  }
  // At the original's own size, crop / turn / flip only move whole pixels. Smoothing is switched off then so
  // every pixel is copied exactly: a smoothing filter (some browsers apply one even when nothing is scaled)
  // would soften the picture. Smoothing is used only when the size really changes.
  const exact = kx === 1 && ky === 1 && dw === g.rotW && dh === g.rotH;
  ctx.imageSmoothingEnabled = !exact;
  ctx.imageSmoothingQuality = "high";
  const m = drawMatrix({ ...g, outW: dw, outH: dh }, state);
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  // The source rectangle is the crop; the destination is the same rectangle in crop-local coordinates.
  ctx.drawImage(source, g.crop.x * kx, g.crop.y * ky, g.crop.w * kx, g.crop.h * ky, 0, 0, g.crop.w, g.crop.h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

function release(canvas: CanvasLike): void {
  canvas.width = 0;
  canvas.height = 0;
}

export function renderEdited(source: { width: number; height: number }, state: EditState, factory: CanvasFactory, options: RenderOptions = {}): CanvasLike {
  const originalW = options.originalWidth ?? source.width;
  const originalH = options.originalHeight ?? source.height;
  const kx = source.width / originalW;
  const ky = source.height / originalH;
  const g = geometry(originalW, originalH, state);
  const dw = options.width ?? g.outW;
  const dh = options.height ?? g.outH;
  const background = options.background ?? null;

  let result: CanvasLike;
  const reduction = Math.min(dw / g.rotW, dh / g.rotH);
  if (reduction >= 0.5) {
    // Same size, a small reduction or any enlargement: one pass.
    result = drawOriented(source, g, state, kx, ky, dw, dh, factory, background);
  } else {
    // A big reduction: orient at the kept size, then halve until within a factor of two, then the last step.
    let current = drawOriented(source, g, state, kx, ky, g.rotW, g.rotH, factory, background);
    let cw = g.rotW;
    let ch = g.rotH;
    while (dw < cw / 2 || dh < ch / 2) {
      const nw = Math.max(dw, Math.ceil(cw / 2));
      const nh = Math.max(dh, Math.ceil(ch / 2));
      const next = factory(nw, nh);
      const nctx = context(next);
      nctx.imageSmoothingEnabled = true;
      nctx.imageSmoothingQuality = "high";
      nctx.drawImage(current, 0, 0, cw, ch, 0, 0, nw, nh);
      release(current);
      current = next;
      cw = nw;
      ch = nh;
    }
    if (cw !== dw || ch !== dh) {
      const last = factory(dw, dh);
      const lctx = context(last);
      lctx.imageSmoothingEnabled = true;
      lctx.imageSmoothingQuality = "high";
      lctx.drawImage(current, 0, 0, cw, ch, 0, 0, dw, dh);
      release(current);
      current = last;
    }
    result = current;
  }

  if (state.brightness !== 0 || state.contrast !== 0) adjustInStrips(result, state.brightness, state.contrast);
  return result;
}

function adjustInStrips(canvas: CanvasLike, brightness: number, contrast: number): void {
  const ctx = context(canvas);
  for (let y = 0; y < canvas.height; y += STRIP_ROWS) {
    const rows = Math.min(STRIP_ROWS, canvas.height - y);
    const strip = ctx.getImageData(0, y, canvas.width, rows);
    applyAdjustments(strip, brightness, contrast);
    ctx.putImageData(strip, 0, y);
  }
}

// A smaller copy of the original to draw previews from (so moving a slider doesn't resample 48 megapixels).
// Returns the source itself when it is already small. Made by halving, so it is a fair average.
export function makeProxy(source: { width: number; height: number }, maxSide: number, factory: CanvasFactory): { width: number; height: number } {
  const long = Math.max(source.width, source.height);
  if (long <= maxSide) return source;
  const scale = maxSide / long;
  const tw = Math.max(1, Math.round(source.width * scale));
  const th = Math.max(1, Math.round(source.height * scale));
  let current: { width: number; height: number } = source;
  let cw = source.width;
  let ch = source.height;
  while (tw < cw / 2 || th < ch / 2) {
    const nw = Math.max(tw, Math.ceil(cw / 2));
    const nh = Math.max(th, Math.ceil(ch / 2));
    const next = factory(nw, nh);
    const nctx = context(next);
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(current, 0, 0, cw, ch, 0, 0, nw, nh);
    if (current !== source) release(current as CanvasLike);
    current = next;
    cw = nw;
    ch = nh;
  }
  if (cw !== tw || ch !== th) {
    const last = factory(tw, th);
    const lctx = context(last);
    lctx.imageSmoothingEnabled = true;
    lctx.imageSmoothingQuality = "high";
    lctx.drawImage(current, 0, 0, cw, ch, 0, 0, tw, th);
    if (current !== source) release(current as CanvasLike);
    current = last;
  }
  return current;
}
