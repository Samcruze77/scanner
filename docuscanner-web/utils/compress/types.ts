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
  compressedBytes: number;
  // Whole-number percentage saved. Only meaningful when `meaningful` is true.
  reductionPct: number;
  // False when the result isn't worth reporting or offering: the file barely
  // changed (or got bigger), so it is already about as small as it can safely be.
  meaningful: boolean;
  // Whether a requested target size was reached; null when there was no target.
  targetMet: boolean | null;
  targetBytes: number | null;
  // Plain-language facts about what was and wasn't done.
  notes: string[];
  // PDF only: a stronger option exists (turns pages into pictures).
  strongAvailable: boolean;
}

// A change must save at least this much of the file, and at least this many
// bytes, before it is reported as compression.
const MIN_REDUCTION = 0.03;
const MIN_SAVED_BYTES = 1024;

export function isMeaningfulReduction(original: number, compressed: number): boolean {
  return original - compressed >= MIN_SAVED_BYTES && compressed <= original * (1 - MIN_REDUCTION);
}

export function reductionPercent(original: number, compressed: number): number {
  if (original <= 0) return 0;
  return Math.max(0, Math.round(((original - compressed) / original) * 100));
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

// The compression "levels" tried in order until a target is met. Quality never
// drops below what still reads well, and pictures never shrink below the floor.
export interface Level {
  quality: number;
  maxDim: number;
}

export const IMAGE_LEVELS: Level[] = [
  { quality: 0.82, maxDim: 3000 },
  { quality: 0.74, maxDim: 2200 },
  { quality: 0.66, maxDim: 1700 },
  { quality: 0.58, maxDim: 1300 },
  { quality: 0.5, maxDim: 1000 },
  { quality: 0.45, maxDim: 800 },
];

// The level used when no target size is given: a good balance for most files.
export const BALANCED_LEVEL = 1;
