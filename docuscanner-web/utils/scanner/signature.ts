"use client";

// Turns a drawn, typed or uploaded signature into a transparent, tightly
// cropped PNG that can be placed on a page. Everything stays in the browser;
// nothing is stored beyond the current session.

import { SIGNATURE_FONT_STACK } from "./annotations";

export const MAX_SIGNATURE_UPLOAD_BYTES = 5 * 1024 * 1024;
// Uploaded photos are scaled down to this width: plenty for a signature, and it
// keeps the page (and the exported PDF) small.
const MAX_UPLOAD_WIDTH_PX = 900;
const TRIM_PADDING_PX = 6;

export interface SignatureImage {
  dataUrl: string;
  width: number;
  height: number;
}

// Crops away the transparent margin around whatever was drawn, so the
// signature's box hugs the ink and scales sensibly when placed. Returns null
// if nothing was drawn.
export function trimToPng(source: HTMLCanvasElement): SignatureImage | null {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = source;
  const { data } = ctx.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  minX = Math.max(0, minX - TRIM_PADDING_PX);
  minY = Math.max(0, minY - TRIM_PADDING_PX);
  maxX = Math.min(width - 1, maxX + TRIM_PADDING_PX);
  maxY = Math.min(height - 1, maxY + TRIM_PADDING_PX);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  outCtx.drawImage(source, minX, minY, w, h, 0, 0, w, h);
  return { dataUrl: out.toDataURL("image/png"), width: w, height: h };
}

// A signature typed in a handwriting-style face (whatever the device offers;
// see SIGNATURE_FONT_STACK), rendered to an image so it looks the same later.
export function renderTypedSignature(text: string, color: string): SignatureImage | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fontPx = 120;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  const font = `italic ${fontPx}px ${SIGNATURE_FONT_STACK}`;
  measure.font = font;
  const textWidth = Math.ceil(measure.measureText(trimmed).width);

  const canvas = document.createElement("canvas");
  canvas.width = textWidth + 80;
  canvas.height = Math.ceil(fontPx * 1.7);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(trimmed, 40, fontPx * 1.15);
  return trimToPng(canvas);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = url;
  });
}

// Brightness relative to the paper at which a pixel is paper (fully transparent) and at which it is
// certainly ink (fully opaque). On pure white paper these are the grey levels 225 and 160.
const PAPER_FROM = 225 / 255;
const INK_BELOW = 160 / 255;

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = total * fraction;
  let seen = 0;
  for (let level = 0; level < histogram.length; level++) {
    seen += histogram[level];
    if (seen >= target) return level;
  }
  return histogram.length - 1;
}

// How bright the paper is around each pixel, as a coarse grid of cells (the brighter part of every cell is
// paper; the ink is a small part of it). Read back with bilinear interpolation, so uneven light across a
// photographed sheet is followed smoothly.
function paperLevels(luminance: Float32Array, width: number, height: number): (x: number, y: number) => number {
  const cell = Math.max(16, Math.round(Math.max(width, height) / 10));
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const grid = new Float32Array(cols * rows);
  const histogram = new Uint32Array(256);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      histogram.fill(0);
      const x1 = Math.min(width, (c + 1) * cell);
      const y1 = Math.min(height, (r + 1) * cell);
      let count = 0;
      for (let y = r * cell; y < y1; y++) {
        for (let x = c * cell; x < x1; x++) {
          histogram[Math.round(luminance[y * width + x])]++;
          count++;
        }
      }
      grid[r * cols + c] = Math.max(1, percentile(histogram, count, 0.8));
    }
  }
  return (x, y) => {
    const gx = Math.min(cols - 1, Math.max(0, x / cell - 0.5));
    const gy = Math.min(rows - 1, Math.max(0, y / cell - 0.5));
    const c0 = Math.floor(gx);
    const r0 = Math.floor(gy);
    const c1 = Math.min(cols - 1, c0 + 1);
    const r1 = Math.min(rows - 1, r0 + 1);
    const fx = gx - c0;
    const fy = gy - r0;
    const top = grid[r0 * cols + c0] * (1 - fx) + grid[r0 * cols + c1] * fx;
    const bottom = grid[r1 * cols + c0] * (1 - fx) + grid[r1 * cols + c1] * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

// Makes the paper transparent (fading softly at the edges of the ink), so a photo or scan of a signature
// can sit on a page without a box around it. Brightness is judged against the paper around each pixel, not
// against pure white: a phone photo taken indoors has grey paper (often 170 to 200, darker towards one
// side), which a fixed "near white" rule leaves behind as a grey haze over the whole signature box.
export function whiteToTransparent(imageData: ImageData): void {
  const { data, width, height } = imageData;
  const luminance = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // A picture that already has see-through areas (a PNG signature) is judged as it looks on white paper.
    const opacity = data[i + 3] / 255;
    luminance[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * opacity + 255 * (1 - opacity);
  }
  const paperAt = paperLevels(luminance, width, height);

  // Brightness of each pixel as a share of its paper, and how dark the ink of this signature gets.
  const relative = new Float32Array(width * height);
  const histogram = new Uint32Array(256);
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p++) {
      const value = Math.min(1, luminance[p] / paperAt(x, y));
      relative[p] = value;
      histogram[Math.round(value * 255)]++;
    }
  }
  const darkest = percentile(histogram, width * height, 0.005) / 255;
  // Pale ink (pencil, a light ballpoint) is made solid too: "certainly ink" moves up towards the paper
  // level when even the darkest strokes are not dark, but always leaves a soft edge.
  const inkBelow = Math.min(PAPER_FROM - 0.05, Math.max(INK_BELOW, darkest + 0.3 * (PAPER_FROM - darkest)));
  const range = PAPER_FROM - inkBelow;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const value = relative[p];
    const alpha = value >= PAPER_FROM ? 0 : value <= inkBelow ? 255 : ((PAPER_FROM - value) / range) * 255;
    data[i + 3] = Math.min(data[i + 3], alpha);
  }
}

export async function processUploadedSignature(file: File, removeWhiteBackground: boolean): Promise<SignatureImage | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_UPLOAD_WIDTH_PX / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (removeWhiteBackground) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      whiteToTransparent(imageData);
      ctx.putImageData(imageData, 0, 0);
    }
    return trimToPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
