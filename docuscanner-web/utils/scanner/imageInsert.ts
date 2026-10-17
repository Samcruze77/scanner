"use client";

// The pixel work for "Add image": checking a chosen file, decoding it at a safe
// size, and baking a rotation or crop into a new picture. Everything happens in
// the browser; the picture is never uploaded. Geometry and file-type rules are
// in imagePlacement.ts so they can be tested without a browser.

import {
  describeUnsupportedImage,
  MAX_INSERT_IMAGE_BYTES,
  MAX_INSERT_IMAGE_PIXELS,
  MAX_INSERT_IMAGE_SIDE_PX,
  sniffImageKind,
  type InsertImageKind,
  type Rect,
} from "./imagePlacement";

export interface InsertImage {
  dataUrl: string;
  width: number;
  height: number;
  // PNG keeps transparency (logos, stamps); everything else is saved as JPEG.
  mime: "image/png" | "image/jpeg";
}

export class InsertImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsertImageError";
  }
}

const JPEG_QUALITY = 0.92;

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

// Checks the file by its real content and returns the picture at a safe size
// (longest side capped), with the camera's orientation already applied.
// Throws InsertImageError with a message that is fine to show to the person.
export async function readInsertImage(file: File): Promise<InsertImage> {
  if (file.size === 0) throw new InsertImageError("That file is empty. Choose a different picture.");
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
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
    const scale = Math.min(1, MAX_INSERT_IMAGE_SIDE_PX / Math.max(w, h));
    const [canvas, ctx] = makeCanvas(w * scale, h * scale);
    if (kind === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // PNG and WebP are kept as PNG only when they really use transparency (a logo,
    // a stamp); an opaque one is a photo and is far smaller as a JPEG.
    const mime = kind !== "jpeg" && usesTransparency(ctx, canvas.width, canvas.height) ? "image/png" : "image/jpeg";
    if (mime === "image/jpeg" && kind !== "jpeg") {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    return encode(canvas, mime);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// A copy turned 90 degrees (clockwise when `turns` is 1, anticlockwise when -1).
export async function rotateInsertImage(image: { dataUrl: string; mime?: InsertImage["mime"] }, turns: 1 | -1): Promise<InsertImage> {
  const img = await loadImage(image.dataUrl);
  const mime = image.mime ?? (image.dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg");
  const [canvas, ctx] = makeCanvas(img.naturalHeight, img.naturalWidth);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return encode(canvas, mime);
}

// A copy cut down to `rect` (fractions of the image), keeping its own pixels.
export async function cropInsertImage(
  image: { dataUrl: string; mime?: InsertImage["mime"] },
  rect: Rect,
): Promise<InsertImage> {
  const img = await loadImage(image.dataUrl);
  const mime = image.mime ?? (image.dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg");
  const sx = Math.round(rect.x * img.naturalWidth);
  const sy = Math.round(rect.y * img.naturalHeight);
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(rect.w * img.naturalWidth)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(rect.h * img.naturalHeight)));
  const [canvas, ctx] = makeCanvas(sw, sh);
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return encode(canvas, mime);
}

export async function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = await loadImage(dataUrl);
  return { width: img.naturalWidth, height: img.naturalHeight };
}
