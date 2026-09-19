"use client";

import type { PDFPageProxy } from "pdfjs-dist";

// Never magnify a small page by more than this, and never render a huge page
// (e.g. a poster-sized PDF) larger than the target.
const MAX_SCALE = 4;

export interface RenderedPdfPage {
  dataUrl: string;
  width: number;
  height: number;
}

// Renders one PDF page to a JPEG whose long side is about `longSidePx`. The
// caller is responsible for calling `page.cleanup()` afterwards.
export async function renderPdfPage(
  page: PDFPageProxy,
  longSidePx: number,
  jpegQuality = 0.85,
): Promise<RenderedPdfPage> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_SCALE, longSidePx / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  // JPEG has no alpha channel; without this, transparent PDF pages would
  // encode as black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const rendered = { dataUrl: canvas.toDataURL("image/jpeg", jpegQuality), width: canvas.width, height: canvas.height };
  // Free the canvas backing store promptly (matters on iOS Safari).
  canvas.width = canvas.height = 0;
  return rendered;
}
