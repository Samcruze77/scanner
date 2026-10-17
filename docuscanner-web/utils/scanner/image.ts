"use client";

import { dataUrlBytes, debugLog } from "./debugLog";

// Normalizes every raw page source (camera frame or uploaded file) into the
// same shape: a JPEG data URL drawn through a canvas. This is the immutable
// "original" that utils/scanner/page.ts wraps with processing state (crop,
// rotation, enhancement) -- it is never mutated after capture.

export interface CapturedImage {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  // True when the picture had transparent areas that were filled with white, because scanner
  // pages are opaque JPEG pages. (The Add image tool is the way to keep transparency.)
  flattenedTransparency?: boolean;
  // For a page rendered from a PDF: its real size in points, so the exported PDF can keep it.
  widthPt?: number;
  heightPt?: number;
}

// Only a memory guard: a 12MP phone frame (4032x3024) is kept at native size.
// 4096px on the long side is ~350 dpi on A4, so text stays sharp when zoomed.
const MAX_DIMENSION = 4096;
const JPEG_QUALITY = 0.92;

function drawSourceToCapture(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  sourceLabel: string,
): CapturedImage {
  let width = naturalWidth;
  let height = naturalHeight;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  // JPEG has no alpha channel and a new canvas is transparent black, so without this every
  // transparent pixel (a logo's or signature's background) would be saved as BLACK.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const flattenedTransparency = hasTransparency(source, naturalWidth, naturalHeight);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  // Free the full-resolution pixel buffer now; only the encoded JPEG is kept.
  canvas.width = 0;
  canvas.height = 0;

  debugLog("capture", {
    source: sourceLabel,
    sourceFrame: `${naturalWidth}x${naturalHeight}`,
    storedOriginal: `${width}x${height}`,
    downscaled: width !== naturalWidth || height !== naturalHeight,
    jpegBytes: dataUrlBytes(dataUrl),
    jpegQuality: JPEG_QUALITY,
  });
  return { id: crypto.randomUUID(), dataUrl, width, height, ...(flattenedTransparency ? { flattenedTransparency } : {}) };
}

// Whether any pixel is see-through, checked on a small copy (enough to find a transparent
// background or soft edges without holding a second full-size pixel buffer).
function hasTransparency(source: CanvasImageSource, naturalWidth: number, naturalHeight: number): boolean {
  if (!(source instanceof HTMLImageElement)) return false; // camera frames are opaque
  const scale = Math.min(1, 256 / Math.max(naturalWidth, naturalHeight));
  const w = Math.max(1, Math.round(naturalWidth * scale));
  const h = Math.max(1, Math.round(naturalHeight * scale));
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = src;
  });
}

export async function fileToCapturedImage(file: File): Promise<CapturedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    return drawSourceToCapture(img, img.naturalWidth, img.naturalHeight, "upload");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function captureVideoFrame(video: HTMLVideoElement): CapturedImage {
  return drawSourceToCapture(video, video.videoWidth, video.videoHeight, "camera");
}
