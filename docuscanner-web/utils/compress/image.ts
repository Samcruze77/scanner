// Image compression: re-encodes a picture at a lower quality and/or size, either
// to a chosen quality and dimension, or searching for the best quality that
// fits a target file size.

import {
  CompressError,
  isMeaningfulReduction,
  reductionPercent,
  type CompressDeps,
  type CompressReport,
  type EncodedImage,
  type ImageCodec,
} from "./types.ts";

export interface ImageOptions {
  // 0.3..0.95, used when there is no target size.
  quality: number;
  // Longest side in pixels; null keeps the size.
  maxDim: number | null;
  // Target size in bytes; null = use the quality/dimension above.
  target: number | null;
  format: "auto" | "jpeg" | "webp" | "png";
}

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = { quality: 0.75, maxDim: null, target: null, format: "auto" };

// The best quality/size trade-offs are searched within this window; below it a
// photo starts to look damaged.
const MIN_QUALITY = 0.5;
const MAX_QUALITY = 0.86;
// Smallest long side the search will shrink to.
const MIN_LONG_SIDE = 640;
const SCALES = [1, 0.85, 0.7, 0.58, 0.48, 0.4];

function extensionFor(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "image";
}

export async function compressImage(
  input: { data: Uint8Array; mime: string; name: string },
  options: ImageOptions,
  deps: CompressDeps,
): Promise<CompressReport> {
  const codec: ImageCodec = deps.codec;
  const decoded = await codec.decode(input.data, input.mime);
  if (!decoded) throw new CompressError("compress_invalid");

  try {
    const format: "jpeg" | "png" | "webp" =
      options.format !== "auto" ? options.format : decoded.hasAlpha ? (input.mime === "image/png" ? "png" : "webp") : "jpeg";
    const notes: string[] = [];
    if (format === "jpeg" && decoded.hasAlpha) notes.push("Transparent areas were filled with white because JPEG has no transparency.");
    const longSide = Math.max(decoded.width, decoded.height);

    let best: EncodedImage | null = null;
    let targetMet: boolean | null = null;

    if (options.target === null) {
      const maxDim = options.maxDim !== null && options.maxDim < longSide ? options.maxDim : null;
      best = await decoded.encode({ maxDim, quality: options.quality, format });
    } else {
      // Look for the best quality that fits, first at full size, then smaller.
      targetMet = false;
      for (const scale of SCALES) {
        const dim = Math.round(longSide * scale);
        if (scale < 1 && dim < Math.min(MIN_LONG_SIDE, longSide)) break;
        const maxDim = scale === 1 ? (options.maxDim !== null && options.maxDim < longSide ? options.maxDim : null) : dim;
        if (format === "png") {
          const attempt = await decoded.encode({ maxDim, quality: 1, format });
          if (attempt && (!best || attempt.data.length < best.data.length)) best = attempt;
          if (attempt && attempt.data.length <= options.target) {
            targetMet = true;
            break;
          }
          continue;
        }
        // Binary search the highest quality at this size that fits.
        let lo = MIN_QUALITY;
        let hi = MAX_QUALITY;
        const worst = await decoded.encode({ maxDim, quality: lo, format });
        if (!worst) continue;
        if (!best || worst.data.length < best.data.length) best = worst;
        if (worst.data.length > options.target) continue; // even the lowest acceptable quality is too big here
        let fit = worst;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          const attempt = await decoded.encode({ maxDim, quality: mid, format });
          if (!attempt) break;
          if (attempt.data.length <= options.target) {
            fit = attempt;
            lo = mid;
          } else {
            hi = mid;
          }
        }
        best = fit;
        targetMet = true;
        break;
      }
    }

    if (!best) throw new CompressError("compress_failed");

    const original = input.data.length;
    const compressed = best.data.length;
    const meaningful = isMeaningfulReduction(original, compressed);
    if (!meaningful) notes.push("This image is already about as small as it can be without losing noticeable quality.");
    if (best.width !== decoded.width || best.height !== decoded.height) {
      notes.push(`Resized from ${decoded.width}×${decoded.height} to ${best.width}×${best.height} pixels.`);
    }

    return {
      data: best.data,
      mime: best.mime,
      filename: `${baseName(input.name)}-compressed.${extensionFor(best.mime)}`,
      originalBytes: original,
      compressedBytes: compressed,
      reductionPct: reductionPercent(original, compressed),
      meaningful,
      targetMet,
      targetBytes: options.target,
      notes,
      strongAvailable: false,
    };
  } finally {
    decoded.dispose();
  }
}
