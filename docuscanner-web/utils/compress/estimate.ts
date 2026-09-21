// Shared picture re-encoding and the size estimates shown before compressing.
//
// A file's final size can't be known without doing the work, so the estimate is
// built from real re-encodes of a sample of its biggest pictures (the pictures are
// where nearly all the weight is), extrapolated to the rest. When a file has only
// a few pictures the sample is all of them, which makes the estimate close to
// exact. The exact figure is always measured after compression and shown then.

import type { CompressDeps, DecodedImage, EncodedImage, Level } from "./types.ts";
import { COMPRESSION_LEVELS } from "./types.ts";

// A picture is only replaced when the new one is at least this much smaller.
export const REPLACE_RATIO = 0.95;

// Lets the UI stop an estimate that the person has already moved past.
export interface AbortLike {
  aborted: boolean;
}

// Re-encodes one decoded picture at a level. Returns null when the result would
// not be meaningfully smaller than the picture it came from.
export async function reencode(
  decoded: DecodedImage,
  originalBytes: number,
  level: Level,
  format: "jpeg" | "png" | "webp",
): Promise<EncodedImage | null> {
  const longSide = Math.max(decoded.width, decoded.height);
  const encoded = await decoded.encode({ maxDim: longSide > level.maxDim ? level.maxDim : null, quality: level.quality, format });
  return encoded && encoded.data.length < originalBytes * REPLACE_RATIO ? encoded : null;
}

export interface PictureSample {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
}


const MAX_SAMPLE = 8;

// Ranks (0 = biggest picture) to sample: evenly spread from the biggest to the
// smallest, so the estimate isn't biased toward the largest pictures, which shrink
// proportionally more than small ones that are already under the size cap.
function sampleRanks(count: number): number[] {
  if (count <= MAX_SAMPLE) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: MAX_SAMPLE }, (_, k) => Math.round((k * (count - 1)) / (MAX_SAMPLE - 1)));
}

// `baseline` is the size of the file with its pictures untouched. Returns one
// estimated size per level (index-aligned with COMPRESSION_LEVELS) and calls
// `onEstimate` as the sample grows so the screen can fill in progressively. Every
// picture is assumed to shrink by the same fraction as the nearest sampled picture
// in size.
export async function estimateFromPictures(args: {
  baseline: number;
  pictures: PictureSample[];
  deps: CompressDeps;
  signal?: AbortLike;
  onEstimate?: (sizes: number[]) => void;
}): Promise<number[]> {
  const { baseline, pictures, deps, signal, onEstimate } = args;
  const levels = COMPRESSION_LEVELS.length;
  if (pictures.length === 0) return COMPRESSION_LEVELS.map(() => baseline);

  const sorted = [...pictures].sort((a, b) => b.bytes.length - a.bytes.length);
  // What fraction of its size each sampled picture keeps at each level.
  const done: { rank: number; kept: number[] }[] = [];

  const current = (): number[] => {
    if (done.length === 0) return COMPRESSION_LEVELS.map(() => baseline);
    const saved = new Array<number>(levels).fill(0);
    sorted.forEach((picture, rank) => {
      let nearest = done[0];
      for (const sample of done) if (Math.abs(sample.rank - rank) < Math.abs(nearest.rank - rank)) nearest = sample;
      for (let i = 0; i < levels; i++) saved[i] += picture.bytes.length * (1 - nearest.kept[i]);
    });
    return saved.map((s) => Math.max(1024, Math.round(baseline - s)));
  };

  for (const rank of sampleRanks(sorted.length)) {
    if (signal?.aborted) break;
    const picture = sorted[rank];
    const kept = new Array<number>(levels).fill(1);
    // A picture that can't be read here would be left alone, so it keeps everything.
    const decoded = await deps.codec.decode(picture.bytes, picture.mime);
    if (decoded) {
      try {
        const format = picture.mime === "image/png" ? "png" : "jpeg";
        for (let i = 0; i < levels && !signal?.aborted; i++) {
          const encoded = await reencode(decoded, picture.bytes.length, COMPRESSION_LEVELS[i].embedded, format);
          if (encoded) kept[i] = encoded.data.length / picture.bytes.length;
        }
      } finally {
        decoded.dispose();
      }
    }
    if (signal?.aborted) break;
    done.push({ rank, kept });
    onEstimate?.(current());
  }
  return current();
}
