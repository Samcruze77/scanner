"use client";

// Orchestrates the per-page pipeline: crop/perspective-correct -> rotate ->
// enhance -> re-encode. Each stage's heavy-lifting module (detection,
// perspective, enhance) is dynamically imported so none of it lands in the
// initial /scan bundle. Every stage is optional and falls back gracefully --
// the pipeline never throws for a "no confident detection" or "correction
// unsafe" outcome, only for genuine failures (decode error, canvas
// unavailable), which callers should catch and fall back to the original.

import { distance, type Quad } from "./geometry";
import type { ScannerPage } from "./page";

const MAX_OUTPUT_DIMENSION = 1800;
const JPEG_QUALITY = 0.85;

export type ProgressCallback = (label: string) => void;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = dataUrl;
  });
}

function toCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function rotateCanvas(canvas: HTMLCanvasElement, rotation: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (rotation === 0) return canvas;
  const swap = rotation === 90 || rotation === 270;
  const out = document.createElement("canvas");
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function capDimension(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = canvas;
  if (width <= MAX_OUTPUT_DIMENSION && height <= MAX_OUTPUT_DIMENSION) return canvas;
  const scale = MAX_OUTPUT_DIMENSION / Math.max(width, height);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

// Lets the progress label actually paint before the next (blocking) stage
// runs -- these are synchronous canvas loops, not real background work, so
// this is what keeps the UI from looking frozen between stages.
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export interface RenderResult {
  dataUrl: string;
  width: number;
  height: number;
  // True when cropEnabled+quad was requested but the perspective warp
  // failed (degenerate quad) -- the caller should surface this and may
  // want to reset cropEnabled since the result is just the uncropped image.
  perspectiveFailed?: boolean;
}

export async function renderPage(page: ScannerPage, onProgress?: ProgressCallback): Promise<RenderResult> {
  const noOpChange =
    !page.cropEnabled &&
    page.rotation === 0 &&
    page.enhancement === "original" &&
    page.brightness === 0 &&
    page.contrast === 0;
  if (noOpChange) {
    return { dataUrl: page.originalDataUrl, width: page.originalWidth, height: page.originalHeight };
  }

  const img = await loadImage(page.originalDataUrl);
  let canvas = toCanvas(img);
  let perspectiveFailed = false;

  if (page.cropEnabled && page.quad) {
    onProgress?.("Correcting perspective…");
    await yieldToBrowser();
    const { warpPerspective } = await import("./perspective");
    const [tl, tr, , bl] = page.quad;
    const outW = Math.max(100, Math.round(distance(tl, tr)));
    const outH = Math.max(100, Math.round(distance(tl, bl)));
    const warped = warpPerspective(canvas, page.quad, outW, outH);
    if (warped) {
      canvas = warped;
    } else {
      perspectiveFailed = true;
    }
  }

  if (page.rotation !== 0) {
    canvas = rotateCanvas(canvas, page.rotation);
  }

  const hasAdjustments = page.brightness !== 0 || page.contrast !== 0;
  if (page.enhancement !== "original" || hasAdjustments) {
    onProgress?.("Enhancing page…");
    await yieldToBrowser();
    const { applyAdjustments, applyEnhancement } = await import("./enhance");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyEnhancement(imageData, page.enhancement);
      applyAdjustments(imageData, page.brightness, page.contrast);
      ctx.putImageData(imageData, 0, 0);
    }
  }

  canvas = capDimension(canvas);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    width: canvas.width,
    height: canvas.height,
    perspectiveFailed,
  };
}

export interface DetectResult {
  quad: Quad;
  confidence: number;
}

export async function detectPageQuad(page: ScannerPage, onProgress?: ProgressCallback): Promise<DetectResult | null> {
  onProgress?.("Detecting document…");
  await yieldToBrowser();
  const img = await loadImage(page.originalDataUrl);
  const canvas = toCanvas(img);
  const { detectDocumentQuad } = await import("./detection");
  return detectDocumentQuad(canvas);
}
