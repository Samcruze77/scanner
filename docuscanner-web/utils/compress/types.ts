// Shared types and helpers for the compression tools. Everything here is
// dependency-free so the same code runs in the browser and in Node tests.

export type CompressKind = "pdf" | "image" | "word" | "excel";

export type CompressErrorCode =
  | "compress_unsupported_type"
  | "compress_too_large"
  | "compress_invalid"
  | "compress_password"
  | "compress_failed";

export class CompressError extends Error {
  readonly code: CompressErrorCode;
  constructor(code: CompressErrorCode) {
    super(code);
    this.name = "CompressError";
    this.code = code;
  }
}

export interface CompressReport {
  data: Uint8Array;
  mime: string;
  // Suggested download name (extension included).
  filename: string;
  originalBytes: number;
  // Size of the compressed attempt, even when it was not good enough to keep.
  compressedBytes: number;
  // Percentage saved, to one decimal place. Only meaningful when `meaningful` is true.
  reductionPct: number;
  // False when the result isn't worth offering: the file barely changed (or got
  // bigger), so `data` is the untouched original rather than the attempt.
  meaningful: boolean;
  // Whether a requested target size was reached; null when there was no target.
  targetMet: boolean | null;
  targetBytes: number | null;
  // Plain-language facts about what was and wasn't done.
  notes: string[];
  // PDF only: a stronger option exists (turns pages into pictures).
  strongAvailable: boolean;
  // "reduced": smaller by a worthwhile amount. "negligible": barely smaller.
  // "larger": the result was bigger than the original.
  outcome: CompressOutcome;
  // Index into COMPRESSION_LEVELS that produced the result; null for a
  // size-target search on a picture, which isn't one of the fixed levels.
  levelIndex: number | null;
  // How the result was chosen: a level on the slider, searched to meet a target
  // size, or (PDF) pages redrawn as pictures.
  mode: "level" | "target" | "flatten";
}

export type CompressOutcome = "reduced" | "negligible" | "larger";

// What the file is made of and how big each level is expected to make it. Built
// before compressing so the screen can show an estimate; sizes are index-aligned
// with COMPRESSION_LEVELS and null when they can't be estimated.
export interface Analysis {
  estimates: (number | null)[];
  // Pictures that compression can act on, and their combined size in bytes.
  pictureCount: number;
  pictureBytes: number;
}

// A change must save at least this much of the file, and at least this many
// bytes, before it is reported as compression.
const MIN_REDUCTION = 0.03;
const MIN_SAVED_BYTES = 1024;

export function isMeaningfulReduction(original: number, compressed: number): boolean {
  return original - compressed >= MIN_SAVED_BYTES && compressed <= original * (1 - MIN_REDUCTION);
}

// Percentage saved, to one decimal place (67.9), never negative.
export function reductionPercent(original: number, compressed: number): number {
  if (original <= 0) return 0;
  return Math.max(0, Math.round(((original - compressed) / original) * 1000) / 10);
}

export function outcomeOf(original: number, compressed: number): CompressOutcome {
  if (compressed > original) return "larger";
  return isMeaningfulReduction(original, compressed) ? "reduced" : "negligible";
}

// What to hand back: the compressed file when it is really smaller, otherwise the
// original untouched (never a bigger or barely-smaller file dressed up as a win).
export function deliver(
  original: { data: Uint8Array; name: string; mime: string },
  candidate: { data: Uint8Array; name: string; mime: string },
): { data: Uint8Array; name: string; mime: string; outcome: CompressOutcome } {
  const outcome = outcomeOf(original.data.length, candidate.data.length);
  return outcome === "reduced" ? { ...candidate, outcome } : { ...original, outcome };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
}

export const TARGET_PRESETS = [
  { label: "500 KB", bytes: 500 * 1024 },
  { label: "1 MB", bytes: 1024 * 1024 },
  { label: "2 MB", bytes: 2 * 1024 * 1024 },
  { label: "5 MB", bytes: 5 * 1024 * 1024 },
] as const;

export const MIN_TARGET_BYTES = 20 * 1024;

// ---- image codec (implemented by the browser canvas and, in tests, by sharp) ----

export interface EncodeOptions {
  // Longest side in pixels; null keeps the original size. Never enlarges.
  maxDim: number | null;
  // 0..1 for JPEG/WebP; ignored for PNG.
  quality: number;
  format: "jpeg" | "png" | "webp";
}

export interface EncodedImage {
  data: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface DecodedImage {
  width: number;
  height: number;
  hasAlpha: boolean;
  encode(options: EncodeOptions): Promise<EncodedImage | null>;
  dispose(): void;
}

export interface ImageCodec {
  decode(data: Uint8Array, mime: string): Promise<DecodedImage | null>;
}

// Renders PDF pages to JPEG for the "stronger" compression.
export interface PageRenderer {
  pageCount: number;
  render(index: number, scale: number, quality: number): Promise<{ data: Uint8Array; widthPt: number; heightPt: number }>;
  dispose(): Promise<void>;
}

export interface CompressDeps {
  codec: ImageCodec;
  openRenderer?: (data: Uint8Array) => Promise<PageRenderer>;
  // Called with a short status such as "Compressing pictures (2 of 5)".
  onProgress?: (message: string) => void;
}

// ---- compression levels -----------------------------------------------------------
//
// One shared table drives the slider, the size estimates and every compressor, so
// what the screen promises is what the code does. Quality never drops below what
// still reads well, and pictures never shrink below a floor.

export interface Level {
  quality: number;
  maxDim: number;
}

export interface CompressionLevel {
  key: "low" | "balanced" | "medium" | "high" | "maximum";
  // Short label under the slider; `name` is the full name in the description.
  short: string;
  name: string;
  description: string;
  // Shown before compressing when the level trades away visible quality.
  warning: string | null;
  // Standalone pictures: JPEG/WebP quality and the longest side (null = keep size).
  image: { quality: number; maxDim: number | null };
  // Pictures inside a PDF / Word / Excel file (text and layout are never touched).
  embedded: Level;
  // 0-100, only to draw the quality meter; it describes the level, it is not a measurement.
  qualityMeter: number;
  qualityWord: string;
}

export const COMPRESSION_LEVELS: readonly CompressionLevel[] = [
  {
    key: "low",
    short: "Low",
    name: "Low compression",
    description: "Highest quality. A small size reduction with the best document quality.",
    warning: null,
    image: { quality: 0.9, maxDim: null },
    embedded: { quality: 0.85, maxDim: 3000 },
    qualityMeter: 95,
    qualityWord: "Excellent",
  },
  {
    key: "balanced",
    short: "Balanced",
    name: "Balanced",
    description: "Good quality with a noticeable size reduction. Right for most files.",
    warning: null,
    image: { quality: 0.8, maxDim: 3000 },
    embedded: { quality: 0.74, maxDim: 2200 },
    qualityMeter: 78,
    qualityWord: "Very good",
  },
  {
    key: "medium",
    short: "Medium",
    name: "Medium compression",
    description: "Stronger compression, suitable for emailing and general sharing.",
    warning: null,
    image: { quality: 0.7, maxDim: 2200 },
    embedded: { quality: 0.64, maxDim: 1700 },
    qualityMeter: 60,
    qualityWord: "Good",
  },
  {
    key: "high",
    short: "High",
    name: "High compression",
    description: "A much smaller file. Some loss of picture quality is expected.",
    warning: "Pictures and scans will look softer, and fine detail may be lost.",
    image: { quality: 0.6, maxDim: 1600 },
    embedded: { quality: 0.54, maxDim: 1300 },
    qualityMeter: 42,
    qualityWord: "Reduced",
  },
  {
    key: "maximum",
    short: "Maximum",
    name: "Maximum compression",
    description: "The smallest file. Size comes first, quality second.",
    warning: "Quality will drop noticeably. Small print in scanned pages may become hard to read.",
    image: { quality: 0.5, maxDim: 1200 },
    embedded: { quality: 0.45, maxDim: 1000 },
    qualityMeter: 25,
    qualityWord: "Lowest",
  },
];

// The level selected when a file is chosen.
export const DEFAULT_LEVEL = 1;

// Files this small (or smaller) rarely have anything left to save.
export const TINY_FILE_BYTES = 50 * 1024;
