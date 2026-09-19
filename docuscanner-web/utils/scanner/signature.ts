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

// Makes near-white pixels transparent (fading softly at the edges of the ink),
// so a photo or scan of a signature on paper can sit on a page without a white
// box around it.
function whiteToTransparent(imageData: ImageData): void {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Fully transparent above 225, fully opaque below 160, linear between.
    const alpha = luminance >= 225 ? 0 : luminance <= 160 ? 255 : ((225 - luminance) / 65) * 255;
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
