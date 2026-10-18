"use client";

// The browser half of the Edit Image tool: decoding the chosen file (upright, at its full pixel size),
// finding out which download formats this browser can truly write, and producing the download from the
// original pixels. Everything runs on the visitor's device; nothing is uploaded.

import {
  checkInput,
  LOAD_MESSAGES,
  OUTPUT_INFO,
  sniffOutput,
  webpEncoding,
  type EncoderSupport,
  type InputFormat,
  type LoadProblem,
  type OutputFormat,
} from "./formats.ts";
import { geometry, outputProblem, type EditState } from "./ops.ts";
import { makeProxy, renderEdited, type CanvasFactory, type CanvasLike } from "./render.ts";

export class ImageEditError extends Error {
  constructor(
    readonly code: LoadProblem | "decode_failed" | "export_too_large" | "encode_failed" | "canvas_unavailable" | "out_of_memory",
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const ERROR_MESSAGES: Record<ImageEditError["code"], string> = {
  ...LOAD_MESSAGES,
  decode_failed: "This browser couldn't open that picture. It may be damaged or in a variant this browser doesn't support.",
  export_too_large: "The picture would be too large to export in the browser. Reduce its size or crop it, then try again.",
  encode_failed: "This browser couldn't produce that file format. Choose a different format.",
  canvas_unavailable: "This browser couldn't prepare the picture. Try a smaller picture or another browser.",
  out_of_memory: "The picture is too large for this device's memory. Try a smaller picture or reduce its size.",
};

export const domCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as CanvasLike;
};

export interface LoadedImage {
  file: File;
  format: InputFormat;
  // The upright picture at its full pixel size (EXIF rotation already applied).
  bitmap: ImageBitmap;
  width: number;
  height: number;
  // Some pixel is not fully opaque.
  hasAlpha: boolean;
  // A smaller copy the preview is drawn from; the bitmap itself when the picture is already small.
  proxy: { width: number; height: number };
}

const HEAD_BYTES = 2 * 1024 * 1024;
export const PROXY_SIDE = 2400;

export async function loadImage(file: File): Promise<LoadedImage> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const check = checkInput(head, file.size);
  if (!check.ok) throw new ImageEditError(check.problem, LOAD_MESSAGES[check.problem]);

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the photo's own rotation, so a phone picture stays upright. The bytes are
    // typed by what they really are, not by the filename.
    const type = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif" }[check.format];
    bitmap = await createImageBitmap(new Blob([file], { type }), { imageOrientation: "from-image" });
  } catch {
    throw new ImageEditError("decode_failed");
  }
  if (bitmap.width * bitmap.height > 64_000_000) {
    bitmap.close();
    throw new ImageEditError("too_many_pixels");
  }
  const canAlpha = check.format === "png" || check.format === "webp" || check.format === "gif" || check.format === "avif";
  const hasAlpha = canAlpha ? hasTransparentPixels(bitmap) : false;
  let proxy: { width: number; height: number } = bitmap;
  try {
    proxy = makeProxy(bitmap, PROXY_SIDE, domCanvas);
  } catch {
    proxy = bitmap;
  }
  return { file, format: check.format, bitmap, width: bitmap.width, height: bitmap.height, hasAlpha, proxy };
}

export function disposeImage(image: LoadedImage | null): void {
  if (!image) return;
  image.bitmap.close();
  if (image.proxy !== image.bitmap) {
    const p = image.proxy as unknown as HTMLCanvasElement;
    p.width = 0;
    p.height = 0;
  }
}

// Looks through the picture a band at a time (so no full-size copy is made) for any pixel that is not opaque.
function hasTransparentPixels(bitmap: ImageBitmap): boolean {
  const rows = Math.max(1, Math.min(bitmap.height, Math.floor(2_000_000 / bitmap.width)));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  try {
    for (let y = 0; y < bitmap.height; y += rows) {
      const h = Math.min(rows, bitmap.height - y);
      ctx.clearRect(0, 0, canvas.width, rows);
      ctx.drawImage(bitmap, 0, y, bitmap.width, h, 0, 0, bitmap.width, h);
      const data = ctx.getImageData(0, 0, bitmap.width, h).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    }
  } finally {
    canvas.width = canvas.height = 0;
  }
  return false;
}

// ---- which formats this browser can really write -------------------------------------------------------

let probed: Promise<EncoderSupport> | null = null;

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Asks the browser for each format and looks at the first bytes of what comes back. A browser that doesn't
// know a format quietly hands back a PNG, so asking is not enough.
export function probeEncoders(): Promise<EncoderSupport> {
  if (!probed) probed = runProbe();
  return probed;
}

async function runProbe(): Promise<EncoderSupport> {
  const support: EncoderSupport = { jpeg: false, png: false, webp: false, webpLossless: false, avif: false };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return support;
  // A pattern that a lossy encoder cannot reproduce exactly.
  const img = ctx.createImageData(32, 32);
  let seed = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    img.data[i] = seed >>> 24;
    img.data[i + 1] = (seed >>> 16) & 255;
    img.data[i + 2] = (seed >>> 8) & 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const kinds: [OutputFormat | "avif", string][] = [
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
    ["avif", "image/avif"],
  ];
  for (const [key, type] of kinds) {
    try {
      const blob = await toBlob(canvas, type, 0.9);
      if (!blob) continue;
      const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
      if (key === "avif") {
        // Only counts when the bytes really are AVIF (they never are in browsers that can't encode it).
        const text = String.fromCharCode(...head.slice(4, 12));
        support.avif = text.startsWith("ftypavif");
      } else {
        support[key] = sniffOutput(head) === key;
      }
    } catch {
      /* not supported */
    }
  }
  if (support.webp) {
    try {
      const blob = await toBlob(canvas, "image/webp", 1);
      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (webpEncoding(bytes) === "lossless") {
          const bmp = await createImageBitmap(blob);
          const c2 = document.createElement("canvas");
          c2.width = c2.height = 32;
          const x2 = c2.getContext("2d", { willReadFrequently: true });
          if (x2) {
            x2.drawImage(bmp, 0, 0);
            const back = x2.getImageData(0, 0, 32, 32).data;
            let same = back.length === img.data.length;
            for (let i = 0; same && i < back.length; i++) if (back[i] !== img.data[i]) same = false;
            support.webpLossless = same;
          }
          bmp.close();
        }
      }
    } catch {
      /* lossless unknown: stay honest and say lossy */
    }
  }
  canvas.width = canvas.height = 0;
  return support;
}

// ---- producing the download -----------------------------------------------------------------------------

export interface ExportRequest {
  image: LoadedImage;
  state: EditState;
  format: OutputFormat;
  // 1-100
  qualityPercent: number;
  // Fill for transparent areas when the format has no transparency.
  background: string;
  webpLossless: boolean;
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  format: OutputFormat;
}

export async function exportImage(req: ExportRequest): Promise<ExportResult> {
  const g = geometry(req.image.width, req.image.height, req.state);
  if (outputProblem(g.outW, g.outH)) throw new ImageEditError("export_too_large");
  const info = OUTPUT_INFO[req.format];
  let canvas: CanvasLike | null = null;
  try {
    try {
      canvas = renderEdited(req.image.bitmap, req.state, domCanvas, { background: info.alpha ? null : req.background });
    } catch (err) {
      if (err instanceof ImageEditError) throw err;
      throw new ImageEditError(err instanceof Error && err.message === "canvas_unavailable" ? "canvas_unavailable" : "out_of_memory");
    }
    const dom = canvas as unknown as HTMLCanvasElement;
    let quality: number | undefined;
    if (req.format !== "png") quality = req.format === "webp" && req.webpLossless && req.qualityPercent >= 100 ? 1 : Math.min(1, Math.max(0.05, req.qualityPercent / 100));
    const blob = await toBlob(dom, info.mime, quality);
    if (!blob) throw new ImageEditError("encode_failed");
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    // The bytes are checked, not trusted: a file must really be in the format its name says.
    if (sniffOutput(head) !== req.format || blob.type !== info.mime) throw new ImageEditError("encode_failed");
    return { blob, width: g.outW, height: g.outH, format: req.format };
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
