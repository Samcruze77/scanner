"use client";

// The pixel work for "Add image": checking a chosen file, reading it WITHOUT lossy
// re-encoding, and producing edited copies (turned and/or cropped) from the untouched
// original in a single step. Everything happens in the browser; the picture is never
// uploaded. Geometry and file-type rules are in imagePlacement.ts so they can be tested
// without a browser.
//
// Quality rules:
//  - A JPEG or PNG that needs no pixel change is kept byte-for-byte (the data URL is the
//    file itself), so the exported PDF can embed the original data.
//  - Pixels are redrawn only when they must be: the picture is larger than the safe size,
//    its EXIF orientation is not "normal", it is WebP (a PDF cannot embed it), or the
//    person turned/cropped it. Each such result is made from the original in one pass,
//    never from an earlier edit.
//  - JPEG redraws use quality 0.95; PNG stays PNG (lossless, keeps transparency).

import {
  describeUnsupportedImage,
  jpegOrientation,
  MAX_INSERT_IMAGE_BYTES,
  MAX_INSERT_IMAGE_PIXELS,
  MAX_INSERT_IMAGE_SIDE_PX,
  sniffImageKind,
  type InsertImageKind,
  type Rect,
  type Turns,
} from "./imagePlacement";

export interface InsertImage {
  dataUrl: string;
  width: number;
  height: number;
  // PNG keeps transparency (logos, stamps); everything else is JPEG.
  mime: "image/png" | "image/jpeg";
}

export class InsertImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsertImageError";
  }
}

const JPEG_QUALITY = 0.95;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = url;
  });
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new InsertImageError("Your browser can't process pictures here. Try a different browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

function usesTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

function encode(canvas: HTMLCanvasElement, mime: InsertImage["mime"]): InsertImage {
  const dataUrl = canvas.toDataURL(mime, mime === "image/jpeg" ? JPEG_QUALITY : undefined);
  const result: InsertImage = { dataUrl, width: canvas.width, height: canvas.height, mime };
  // Free the backing store promptly (matters on iOS Safari).
  canvas.width = canvas.height = 0;
  return result;
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

// Checks the file by its real content and returns the picture. Throws InsertImageError
// with a message that is fine to show to the person.
export async function readInsertImage(file: File): Promise<InsertImage> {
  if (file.size === 0) throw new InsertImageError("That file is empty. Choose a different picture.");
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const kind: InsertImageKind | null = sniffImageKind(head);
  if (!kind) throw new InsertImageError(describeUnsupportedImage(head, file.name));
  if (file.size > MAX_INSERT_IMAGE_BYTES) {
    throw new InsertImageError(`That picture is larger than ${Math.round(MAX_INSERT_IMAGE_BYTES / 1024 / 1024)} MB. Choose a smaller one or compress it first.`);
  }

  const url = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(url);
    } catch {
      throw new InsertImageError("That picture couldn't be read. It may be damaged. Try a different file.");
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new InsertImageError("That picture couldn't be read. It may be damaged. Try a different file.");
    if (w * h > MAX_INSERT_IMAGE_PIXELS) {
      throw new InsertImageError("That picture has too many pixels to open safely. Resize it and try again.");
    }

    const oversized = Math.max(w, h) > MAX_INSERT_IMAGE_SIDE_PX;
    const rotatedByCamera = kind === "jpeg" && jpegOrientation(head) !== 1;
    // The file itself, untouched, whenever no pixel has to change.
    if (!oversized && !rotatedByCamera && kind !== "webp") {
      return { dataUrl: await fileToDataUrl(file), width: w, height: h, mime: kind === "png" ? "image/png" : "image/jpeg" };
    }

    const scale = Math.min(1, MAX_INSERT_IMAGE_SIDE_PX / Math.max(w, h));
    const [canvas, ctx] = makeCanvas(w * scale, h * scale);
    if (kind === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // Drawing applies the camera's orientation, so the result is upright.
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // PNG/WebP stay PNG only when they really use transparency (a logo, a stamp); an
    // opaque one is a photograph and is far smaller as a high-quality JPEG.
    const keepAlpha = kind !== "jpeg" && usesTransparency(ctx, canvas.width, canvas.height);
    if (kind !== "jpeg" && !keepAlpha) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    return encode(canvas, kind === "jpeg" || !keepAlpha ? "image/jpeg" : "image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The picture after `turns` clockwise quarter turns and then a crop of the turned picture
// (`crop` as fractions), drawn from `original` in one pass. With no edit it returns
// `original` itself, so nothing is re-encoded. `maxSide` produces a small copy for previews.
export async function renderEdit(
  original: { dataUrl: string; mime: InsertImage["mime"] },
  turns: Turns,
  crop: Rect | null,
  maxSide?: number,
): Promise<InsertImage> {
  const img = await loadImage(original.dataUrl);
  const turned = turns % 2 === 1;
  const fullW = turned ? img.naturalHeight : img.naturalWidth;
  const fullH = turned ? img.naturalWidth : img.naturalHeight;
  const whole = !crop || (crop.w > 0.9995 && crop.h > 0.9995);
  if (turns === 0 && whole && !maxSide) {
    return { dataUrl: original.dataUrl, width: img.naturalWidth, height: img.naturalHeight, mime: original.mime };
  }

  const r = whole ? { x: 0, y: 0, w: 1, h: 1 } : (crop as Rect);
  const sx = Math.round(r.x * fullW);
  const sy = Math.round(r.y * fullH);
  const sw = Math.max(1, Math.min(fullW - sx, Math.round(r.w * fullW)));
  const sh = Math.max(1, Math.min(fullH - sy, Math.round(r.h * fullH)));
  const scale = maxSide ? Math.min(1, maxSide / Math.max(sw, sh)) : 1;
  const [canvas, ctx] = makeCanvas(sw * scale, sh * scale);
  if (original.mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // Map the turned picture's (sx, sy) window onto the canvas, then draw the original
  // under that turn: one resample, straight from the source pixels.
  ctx.scale(scale, scale);
  ctx.translate(-sx, -sy);
  ctx.translate(fullW / 2, fullH / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return encode(canvas, original.mime);
}

export async function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = await loadImage(dataUrl);
  return { width: img.naturalWidth, height: img.naturalHeight };
}
