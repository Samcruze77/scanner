// Image compression: re-encodes a picture at a lower quality and/or size, either
// to a chosen quality and dimension, or searching for the best quality that
// fits a target file size.

import type { AbortLike } from "./estimate.ts";
import {
  CompressError,
  COMPRESSION_LEVELS,
  DEFAULT_LEVEL,
  deliver,
  reductionPercent,
  type Analysis,
  type CompressDeps,
  type CompressReport,
  type DecodedImage,
  type EncodedImage,
  type ImageCodec,
} from "./types.ts";

export interface ImageOptions {
  // Index into COMPRESSION_LEVELS: sets the quality and the size cap. Ignored
  // when a target size is given.
  level: number;
  // Longest side in pixels that overrides the level's own cap; null = the level's.
  // With a target, this is the largest size the search starts from (null = full size).
  maxDim: number | null;
  // Target size in bytes; null = use the level.
  target: number | null;
  format: "auto" | "jpeg" | "webp" | "png";
}

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = { level: DEFAULT_LEVEL, maxDim: null, target: null, format: "auto" };

// The best quality/size trade-offs are searched within this window; below it a
// photo starts to look damaged.
const MIN_QUALITY = 0.5;
const MAX_QUALITY = 0.86;
// Smallest long side the search will shrink to.
const MIN_LONG_SIDE = 640;
const SCALES = [1, 0.85, 0.7, 0.58, 0.48, 0.4];

const FORMAT_NAME: Record<string, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

function extensionFor(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "image";
}

function pickFormat(decoded: DecodedImage, mime: string, requested: ImageOptions["format"]): "jpeg" | "png" | "webp" {
  if (requested !== "auto") return requested;
  return decoded.hasAlpha ? (mime === "image/png" ? "png" : "webp") : "jpeg";
}

// The size and quality a level gives, before any target search.
function levelEncode(decoded: DecodedImage, options: ImageOptions, format: "jpeg" | "png" | "webp", level: number) {
  const spec = COMPRESSION_LEVELS[level].image;
  const cap = options.maxDim ?? spec.maxDim;
  const longSide = Math.max(decoded.width, decoded.height);
  return decoded.encode({ maxDim: cap !== null && cap < longSide ? cap : null, quality: spec.quality, format });
}

// Estimated size at every level. The picture is encoded once per level, exactly
// as compression would, so for a single picture the figure is very close to the
// final size (it can differ slightly between browsers or engines).
export async function analyzeImage(
  input: { data: Uint8Array; mime: string },
  options: Pick<ImageOptions, "maxDim" | "format">,
  deps: CompressDeps,
  signal?: AbortLike,
  onEstimate?: (sizes: (number | null)[]) => void,
): Promise<Analysis> {
  const decoded = await deps.codec.decode(input.data, input.mime);
  if (!decoded) throw new CompressError("compress_invalid");
  const estimates: (number | null)[] = COMPRESSION_LEVELS.map(() => null);
  try {
    const format = pickFormat(decoded, input.mime, options.format);
    // Start from the default level, then fan out, so the likeliest pick appears first.
    const order = [DEFAULT_LEVEL, ...COMPRESSION_LEVELS.map((_, i) => i).filter((i) => i !== DEFAULT_LEVEL)];
    for (const level of order) {
      if (signal?.aborted) break;
      const encoded = await levelEncode(decoded, { level, target: null, format: options.format, maxDim: options.maxDim }, format, level);
      estimates[level] = encoded ? encoded.data.length : null;
      if (!signal?.aborted) onEstimate?.([...estimates]);
    }
  } finally {
    decoded.dispose();
  }
  return { estimates, pictureCount: 1, pictureBytes: input.data.length };
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
    const format = pickFormat(decoded, input.mime, options.format);
    const notes: string[] = [];
    if (format === "jpeg" && decoded.hasAlpha) notes.push("Transparent areas were filled with white because JPEG has no transparency.");
    const longSide = Math.max(decoded.width, decoded.height);

    let best: EncodedImage | null = null;
    let targetMet: boolean | null = null;

    if (options.target === null) {
      best = await levelEncode(decoded, options, format, options.level);
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
    // A result that isn't really smaller is never handed back: the original is.
    const delivered = deliver(
      { data: input.data, name: input.name, mime: input.mime },
      { data: best.data, name: `${baseName(input.name)}-compressed.${extensionFor(best.mime)}`, mime: best.mime },
    );
    const meaningful = delivered.outcome === "reduced";
    if (meaningful && (best.width !== decoded.width || best.height !== decoded.height)) {
      notes.push(`Resized from ${decoded.width}×${decoded.height} to ${best.width}×${best.height} pixels.`);
    }
    if (meaningful && best.mime !== input.mime) {
      notes.push(`Saved as ${FORMAT_NAME[best.mime] ?? "an image"} instead of ${FORMAT_NAME[input.mime] ?? "the original format"}.`);
    }

    return {
      data: delivered.data,
      mime: delivered.mime,
      filename: delivered.name,
      originalBytes: original,
      compressedBytes: compressed,
      reductionPct: reductionPercent(original, compressed),
      meaningful,
      targetMet,
      targetBytes: options.target,
      notes,
      strongAvailable: false,
      outcome: delivered.outcome,
      levelIndex: options.target === null ? options.level : null,
      mode: options.target === null ? "level" : "target",
    };
  } finally {
    decoded.dispose();
  }
}
