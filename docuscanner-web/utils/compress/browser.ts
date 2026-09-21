"use client";

// Browser side of the compression tools: a canvas-based picture codec, a PDF.js
// page renderer for the stronger PDF mode, file validation and the dispatcher
// the UI calls. Everything runs locally; files never leave the device. The
// compression algorithms themselves live in image.ts / pdf.ts / ooxml.ts and are
// loaded only when a file is actually compressed.

import type { AbortLike } from "./estimate";
import {
  CompressError,
  DEFAULT_LEVEL,
  type Analysis,
  type CompressDeps,
  type CompressKind,
  type CompressReport,
  type DecodedImage,
  type EncodeOptions,
  type ImageCodec,
  type PageRenderer,
} from "./types";

const MB = 1024 * 1024;

export const MAX_COMPRESS_BYTES: Record<CompressKind, number> = {
  pdf: 100 * MB,
  image: 60 * MB,
  word: 100 * MB,
  excel: 100 * MB,
};

export const COMPRESS_ACCEPT: Record<CompressKind, string> = {
  pdf: ".pdf,application/pdf",
  image: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
  word: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  excel: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// ---- validation --------------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

function imageMime(head: Uint8Array): string | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
  return null;
}

// Checks the extension, size and real file signature before doing any work, so
// a renamed or damaged file gets a clear message instead of a stalled spinner.
export function validateCompressFile(kind: CompressKind, file: File, head: Uint8Array): { mime: string } {
  const name = file.name.toLowerCase();
  if (file.size > MAX_COMPRESS_BYTES[kind]) throw new CompressError("compress_too_large");
  if (file.size === 0) throw new CompressError("compress_invalid");
  switch (kind) {
    case "pdf":
      if (!name.endsWith(".pdf")) throw new CompressError("compress_unsupported_type");
      if (!startsWith(head, [0x25, 0x50, 0x44, 0x46])) throw new CompressError("compress_invalid");
      return { mime: "application/pdf" };
    case "image": {
      if (!/\.(jpe?g|png|webp)$/.test(name)) throw new CompressError("compress_unsupported_type");
      const mime = imageMime(head);
      if (!mime) throw new CompressError("compress_invalid");
      return { mime };
    }
    case "word":
    case "excel": {
      const ext = kind === "word" ? ".docx" : ".xlsx";
      if (!name.endsWith(ext)) throw new CompressError("compress_unsupported_type");
      if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04])) throw new CompressError("compress_invalid");
      return { mime: "application/octet-stream" };
    }
  }
}

// ---- canvas codec ------------------------------------------------------------------

function hasTransparentPixels(bitmap: ImageBitmap): boolean {
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return true;
  return false;
}

let webpSupport: boolean | null = null;
function supportsWebp(): boolean {
  if (webpSupport === null) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupport;
}

export const browserCodec: ImageCodec = {
  async decode(data: Uint8Array, mime: string): Promise<DecodedImage | null> {
    let bitmap: ImageBitmap;
    try {
      // `from-image` applies the photo's rotation so a phone picture stays upright.
      bitmap = await createImageBitmap(new Blob([data as BlobPart], { type: mime }), { imageOrientation: "from-image" });
    } catch {
      return null;
    }
    const canAlpha = mime === "image/png" || mime === "image/webp" || mime === "image/gif";
    const hasAlpha = canAlpha ? hasTransparentPixels(bitmap) : false;

    return {
      width: bitmap.width,
      height: bitmap.height,
      hasAlpha,
      async encode(options: EncodeOptions) {
        const longSide = Math.max(bitmap.width, bitmap.height);
        const scale = options.maxDim && longSide > options.maxDim ? options.maxDim / longSide : 1;
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        // JPEG has no alpha: paint white first or transparent areas would turn black.
        if (options.format === "jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
        }
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, width, height);
        const type = options.format === "jpeg" ? "image/jpeg" : options.format === "webp" ? "image/webp" : "image/png";
        if (options.format === "webp" && !supportsWebp()) {
          canvas.width = canvas.height = 0;
          return null;
        }
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, options.quality));
        canvas.width = canvas.height = 0; // free the backing store promptly (iOS Safari)
        if (!blob || blob.type !== type) return null;
        return { data: new Uint8Array(await blob.arrayBuffer()), mime: type, width, height };
      },
      dispose() {
        bitmap.close();
      },
    };
  },
};

// ---- PDF page renderer (stronger PDF mode) -------------------------------------------

async function openRenderer(data: Uint8Array): Promise<PageRenderer> {
  const { openPdfData } = await import("@/utils/pdf/pdfjs");
  const { doc, destroy } = await openPdfData(data.slice());
  return {
    pageCount: doc.numPages,
    async render(index: number, scale: number, quality: number) {
      const page = await doc.getPage(index + 1);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas_unavailable");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error("encode_failed");
        return { data: new Uint8Array(await blob.arrayBuffer()), widthPt: base.width, heightPt: base.height };
      } finally {
        page.cleanup();
      }
    },
    dispose: destroy,
  };
}

// ---- dispatcher ----------------------------------------------------------------------

export interface CompressRequest {
  kind: CompressKind;
  file: File;
  // Index into COMPRESSION_LEVELS; defaults to Balanced.
  level?: number;
  // Bytes; null to use the level.
  target: number | null;
  // Image only: a longest-side cap that overrides the level's.
  maxDim?: number | null;
  // PDF only: redraw pages as pictures (text no longer selectable).
  strong?: boolean;
  onProgress?: (message: string) => void;
}

export async function compressFile(request: CompressRequest): Promise<CompressReport> {
  const { kind, file } = request;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime } = validateCompressFile(kind, file, bytes.subarray(0, 16));

  const deps: CompressDeps = { codec: browserCodec, openRenderer, onProgress: request.onProgress };
  const level = request.level ?? DEFAULT_LEVEL;
  try {
    switch (kind) {
      case "image": {
        const { compressImage } = await import("./image");
        return await compressImage(
          { data: bytes, mime, name: file.name },
          { level, maxDim: request.maxDim ?? null, target: request.target, format: "auto" },
          deps,
        );
      }
      case "pdf": {
        const { compressPdf } = await import("./pdf");
        return await compressPdf({ data: bytes, name: file.name }, { target: request.target, strong: request.strong ?? false, level }, deps);
      }
      case "word":
      case "excel": {
        const { compressOoxml } = await import("./ooxml");
        return await compressOoxml({ data: bytes, name: file.name }, kind, { target: request.target, level }, deps);
      }
    }
  } catch (error) {
    if (error instanceof CompressError) throw error;
    throw new CompressError("compress_failed");
  }
}

// ---- estimate ------------------------------------------------------------------------

// Reading a huge file just to preview a size would freeze the page, so beyond
// these sizes no estimate is offered (compression itself still works).
const MAX_ESTIMATE_BYTES: Record<CompressKind, number> = {
  pdf: 40 * MB,
  image: 25 * MB,
  word: 40 * MB,
  excel: 40 * MB,
};

export interface AnalyzeRequest {
  kind: CompressKind;
  file: File;
  // Image only: the same size cap that will be passed to compressFile.
  maxDim?: number | null;
  signal?: AbortLike;
  // Called as estimates arrive; sizes are index-aligned with COMPRESSION_LEVELS.
  onEstimate?: (sizes: (number | null)[]) => void;
}

// Opens the file to check it can be compressed (a password-protected or damaged
// PDF is reported here, before the person sets anything) and estimates the size
// each level would give. Returns null when no estimate is possible; that never
// stops the file being compressed.
export async function analyzeFile(request: AnalyzeRequest): Promise<Analysis | null> {
  const { kind, file, signal } = request;
  if (file.size > MAX_ESTIMATE_BYTES[kind]) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime } = validateCompressFile(kind, file, bytes.subarray(0, 16));
  const deps: CompressDeps = { codec: browserCodec };
  try {
    switch (kind) {
      case "image": {
        const { analyzeImage } = await import("./image");
        return await analyzeImage({ data: bytes, mime }, { maxDim: request.maxDim ?? null, format: "auto" }, deps, signal, request.onEstimate);
      }
      case "pdf": {
        const { analyzePdf } = await import("./pdf");
        return await analyzePdf(bytes, deps, signal, request.onEstimate);
      }
      case "word":
      case "excel": {
        const { analyzeOoxml } = await import("./ooxml");
        return await analyzeOoxml(bytes, kind, deps, signal, request.onEstimate);
      }
    }
  } catch (error) {
    // Only problems with the file itself matter to the person; anything else
    // just means there is no estimate.
    if (error instanceof CompressError && (error.code === "compress_password" || error.code === "compress_invalid")) throw error;
    return null;
  }
}
