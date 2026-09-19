"use client";

// The single renderer for annotations. The editor, the read-only overlays on
// thumbnails and previews, and the final PDF export all draw through
// `renderAnnotations`, so what people see while editing is exactly what gets
// flattened into the PDF -- there is no second implementation to drift.
//
// Drawing happens in "reference pixels": the page's processed image size. The
// caller scales the context when drawing smaller (or larger) than that, which
// also keeps text wrapping identical at every size, because wrapping is
// always measured at the reference size.

import {
  FONT_STACK,
  TEXT_LINE_HEIGHT,
  type Annotation,
  type Bounds,
  type InkAnnotation,
  type StampAnnotation,
  type TextAnnotation,
} from "./annotations";
import type { ScannerPage } from "./page";

const HIGHLIGHT_ALPHA = 0.7;
const FLATTEN_JPEG_QUALITY = 0.92;

// ---- text layout ---------------------------------------------------------------

let measureContext: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureContext) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    measureContext = ctx;
  }
  return measureContext;
}

function fontFor(annotation: TextAnnotation, fontPx: number): string {
  return `${annotation.italic ? "italic " : ""}${annotation.bold ? "bold " : ""}${fontPx}px ${FONT_STACK}`;
}

export interface TextLayout {
  lines: string[];
  fontPx: number;
  lineHeightPx: number;
  // Total height of the text block in reference pixels (at least one line, so
  // an empty box is still selectable).
  heightPx: number;
}

// Greedy word wrap, the same rule browsers use for `white-space: pre-wrap`
// text: break at spaces, keep explicit newlines, and split a word that is too
// long for the box.
export function layoutText(annotation: TextAnnotation, pageWidthPx: number): TextLayout {
  const ctx = getMeasureContext();
  const fontPx = annotation.size * pageWidthPx;
  const lineHeightPx = fontPx * TEXT_LINE_HEIGHT;
  const maxWidth = Math.max(1, annotation.w * pageWidthPx);
  ctx.font = fontFor(annotation, fontPx);

  const lines: string[] = [];
  for (const paragraph of annotation.text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      // Doesn't fit: close the current line, then place the word on its own.
      if (line !== "") lines.push(line);
      // A single word wider than the box is broken across lines.
      let rest = word;
      while (ctx.measureText(rest).width > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }

  return { lines, fontPx, lineHeightPx, heightPx: Math.max(1, lines.length) * lineHeightPx };
}

// ---- bounds & hit testing ------------------------------------------------------

export function annotationBounds(annotation: Annotation, pageWidthPx: number, pageHeightPx: number): Bounds {
  switch (annotation.type) {
    case "text":
      return {
        x: annotation.x,
        y: annotation.y,
        w: annotation.w,
        h: layoutText(annotation, pageWidthPx).heightPx / pageHeightPx,
      };
    case "ink": {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of annotation.points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      const padX = annotation.width / 2;
      const padY = (annotation.width * pageWidthPx) / 2 / pageHeightPx;
      return { x: minX - padX, y: minY - padY, w: maxX - minX + padX * 2, h: maxY - minY + padY * 2 };
    }
    default:
      return { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h };
  }
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// True if the point (normalized) is on the annotation, within `tolerancePx`
// reference pixels -- so thin pen strokes and small stamps are still easy to
// grab with a finger.
export function hitTest(
  annotation: Annotation,
  nx: number,
  ny: number,
  pageWidthPx: number,
  pageHeightPx: number,
  tolerancePx: number,
): boolean {
  const px = nx * pageWidthPx;
  const py = ny * pageHeightPx;

  if (annotation.type === "ink") {
    const reach = (annotation.width * pageWidthPx) / 2 + tolerancePx;
    const pts = annotation.points.map(([x, y]) => [x * pageWidthPx, y * pageHeightPx] as const);
    if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= reach;
    for (let i = 1; i < pts.length; i++) {
      if (distanceToSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= reach) return true;
    }
    return false;
  }

  const b = annotationBounds(annotation, pageWidthPx, pageHeightPx);
  return (
    px >= b.x * pageWidthPx - tolerancePx &&
    px <= (b.x + b.w) * pageWidthPx + tolerancePx &&
    py >= b.y * pageHeightPx - tolerancePx &&
    py <= (b.y + b.h) * pageHeightPx + tolerancePx
  );
}

// Topmost annotation under the point, or null.
export function findAnnotationAt(
  annotations: Annotation[],
  nx: number,
  ny: number,
  pageWidthPx: number,
  pageHeightPx: number,
  tolerancePx: number,
): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (hitTest(annotations[i], nx, ny, pageWidthPx, pageHeightPx, tolerancePx)) return annotations[i];
  }
  return null;
}

// ---- images --------------------------------------------------------------------

// Signature images are decoded once and reused across redraws.
const imageCache = new Map<string, HTMLImageElement>();

export function loadAnnotationImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(dataUrl);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(dataUrl, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = dataUrl;
  });
}

export function hasUnloadedImages(annotations: Annotation[]): boolean {
  return annotations.some((a) => a.type === "signature" && !imageCache.has(a.dataUrl));
}

export async function ensureAnnotationImages(annotations: Annotation[]): Promise<void> {
  await Promise.all(
    annotations.flatMap((a) => (a.type === "signature" ? [loadAnnotationImage(a.dataUrl).catch(() => undefined)] : [])),
  );
}

// ---- drawing -------------------------------------------------------------------

function drawText(ctx: CanvasRenderingContext2D, annotation: TextAnnotation, pageW: number, pageH: number): void {
  const layout = layoutText(annotation, pageW);
  ctx.font = fontFor(annotation, layout.fontPx);
  ctx.fillStyle = annotation.color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Browsers centre the glyphs' ascent+descent inside each line box; do the
  // same so the exported text sits exactly where the editor showed it.
  const metrics = ctx.measureText("Mg");
  const ascent = metrics.fontBoundingBoxAscent ?? layout.fontPx * 0.905;
  const descent = metrics.fontBoundingBoxDescent ?? layout.fontPx * 0.212;
  const baseline = (layout.lineHeightPx - (ascent + descent)) / 2 + ascent;

  layout.lines.forEach((line, index) => {
    ctx.fillText(line, annotation.x * pageW, annotation.y * pageH + index * layout.lineHeightPx + baseline);
  });
}

function drawInk(ctx: CanvasRenderingContext2D, annotation: InkAnnotation, pageW: number, pageH: number): void {
  const pts = annotation.points;
  if (pts.length === 0) return;
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = annotation.width * pageW;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * pageW, pts[0][1] * pageH, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Curve through the midpoints of successive samples for a smooth line.
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * pageW, pts[0][1] * pageH);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = ((pts[i][0] + pts[i + 1][0]) / 2) * pageW;
    const midY = ((pts[i][1] + pts[i + 1][1]) / 2) * pageH;
    ctx.quadraticCurveTo(pts[i][0] * pageW, pts[i][1] * pageH, midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0] * pageW, last[1] * pageH);
  ctx.stroke();
}

function drawStamp(ctx: CanvasRenderingContext2D, annotation: StampAnnotation, pageW: number, pageH: number): void {
  const x = annotation.x * pageW;
  const y = annotation.y * pageH;
  const w = annotation.w * pageW;
  const h = annotation.h * pageH;
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.13);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (annotation.type === "check") {
    ctx.moveTo(x + w * 0.16, y + h * 0.54);
    ctx.lineTo(x + w * 0.38, y + h * 0.76);
    ctx.lineTo(x + w * 0.84, y + h * 0.24);
  } else {
    ctx.moveTo(x + w * 0.2, y + h * 0.2);
    ctx.lineTo(x + w * 0.8, y + h * 0.8);
    ctx.moveTo(x + w * 0.8, y + h * 0.2);
    ctx.lineTo(x + w * 0.2, y + h * 0.8);
  }
  ctx.stroke();
}

export interface RenderOptions {
  // An annotation being edited in an on-screen text box, drawn by the DOM
  // instead so it isn't shown twice.
  skipId?: string | null;
}

// Draws the annotations in reference pixels: (pageW, pageH) is the processed
// image size, and the context's transform maps that onto the target canvas.
export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  pageW: number,
  pageH: number,
  annotations: Annotation[],
  options: RenderOptions = {},
): void {
  for (const annotation of annotations) {
    if (annotation.id === options.skipId) continue;
    ctx.save();
    switch (annotation.type) {
      case "text":
        drawText(ctx, annotation, pageW, pageH);
        break;
      case "ink":
        drawInk(ctx, annotation, pageW, pageH);
        break;
      case "highlight":
        // Multiply keeps the text under a highlight fully readable.
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = HIGHLIGHT_ALPHA;
        ctx.fillStyle = annotation.color;
        ctx.fillRect(annotation.x * pageW, annotation.y * pageH, annotation.w * pageW, annotation.h * pageH);
        break;
      case "check":
      case "cross":
        drawStamp(ctx, annotation, pageW, pageH);
        break;
      case "signature": {
        const img = imageCache.get(annotation.dataUrl);
        if (img) {
          ctx.drawImage(img, annotation.x * pageW, annotation.y * pageH, annotation.w * pageW, annotation.h * pageH);
        }
        break;
      }
    }
    ctx.restore();
  }
}

// ---- export --------------------------------------------------------------------

function loadPageImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = dataUrl;
  });
}

// The page as it will appear in the PDF: its processed image with every
// annotation flattened onto it. Only called for pages that have annotations,
// so pages without any keep the untouched original image.
export async function flattenPageToJpeg(page: ScannerPage): Promise<string> {
  const base = await loadPageImage(page.processedDataUrl);
  const width = base.naturalWidth || page.processedWidth;
  const height = base.naturalHeight || page.processedHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  // JPEG has no alpha; make sure any transparent base pixels aren't black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(base, 0, 0, width, height);

  await ensureAnnotationImages(page.annotations);
  renderAnnotations(ctx, width, height, page.annotations);

  const dataUrl = canvas.toDataURL("image/jpeg", FLATTEN_JPEG_QUALITY);
  // Free the backing store promptly (matters on iOS Safari).
  canvas.width = canvas.height = 0;
  return dataUrl;
}
