// All OCR tunables live here so limits can change per plan (or over time)
// without touching UI code. Values are intentionally generous: basic OCR is
// free at launch and the practical limit is the user's device, not policy.

import type { PlanId } from "@/utils/features/plans";

export const OCR_LANGUAGE = "eng";

// Self-hosted by scripts/copy-ocr-assets.mjs -- nothing is fetched from a
// third-party CDN, and no image ever leaves the browser.
export const OCR_ASSET_PATHS = {
  worker: "/ocr/worker.min.js",
  core: "/ocr/core",
  lang: "/ocr/lang",
} as const;

export interface OcrLimits {
  // Pages processed in one run. Pages are read one at a time, so this bounds
  // total time, not memory.
  maxPagesPerRun: number;
  // Downloading/initialising the engine on a slow connection.
  engineLoadTimeoutMs: number;
  // One page; a dense page on a low-end phone can take a while.
  pageTimeoutMs: number;
  // The image is scaled so its long side is this many pixels before OCR.
  // Scanned pages are capped at ~2000px upstream, which is ~170 DPI for A4;
  // upscaling a bit helps small print, while the cap bounds canvas memory.
  targetLongSidePx: number;
}

const BASIC_LIMITS: OcrLimits = {
  maxPagesPerRun: 30,
  engineLoadTimeoutMs: 90_000,
  pageTimeoutMs: 120_000,
  targetLongSidePx: 2400,
};

export const OCR_LIMITS: Record<PlanId, OcrLimits> = {
  free: BASIC_LIMITS,
  // Same as free until Premium OCR exists.
  premium: BASIC_LIMITS,
};

export function getOcrLimits(plan: PlanId): OcrLimits {
  return OCR_LIMITS[plan];
}

// Below this mean confidence the UI suggests re-scanning/enhancing.
export const OCR_LOW_CONFIDENCE_THRESHOLD = 60;
