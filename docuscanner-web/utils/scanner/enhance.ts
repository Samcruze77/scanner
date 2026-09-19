"use client";

import { otsuThreshold, toGrayscale } from "./pixels";

export type EnhancementMode = "original" | "auto" | "grayscale" | "bw";

export const ENHANCEMENT_MODES: { value: EnhancementMode; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "auto", label: "Auto" },
  { value: "grayscale", label: "Grayscale" },
  { value: "bw", label: "Black & White" },
];

function toGray(imageData: ImageData): void {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
}

// Simple percentile-based contrast stretch: clips the darkest/lightest 1% of
// pixels and stretches the rest across the full 0-255 range. A lightweight
// stand-in for the "auto levels" most scanner apps offer.
function autoLevels(imageData: ImageData): void {
  const { data } = imageData;
  const hist = new Array(256).fill(0);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    hist[data[i]]++;
    count++;
  }

  const clip = count * 0.01;
  let lo = 0;
  let acc = 0;
  for (; lo < 255; lo++) {
    acc += hist[lo];
    if (acc > clip) break;
  }
  let hi = 255;
  acc = 0;
  for (; hi > 0; hi--) {
    acc += hist[hi];
    if (acc > clip) break;
  }
  if (hi <= lo) return;

  const range = hi - lo;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = ((data[i + c] - lo) / range) * 255;
      data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

function binarize(imageData: ImageData): void {
  const gray = toGrayscale(imageData);
  const threshold = otsuThreshold(gray);
  const { data } = imageData;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = gray[j] >= threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

// Manual brightness/contrast, both -100..100 (0 = no change). Uses the
// standard contrast curve pivoting on mid-grey, then a brightness offset, via
// a 256-entry lookup table so it's one pass over the pixels. Mutates in place.
//
// The slider range maps to +/-150 of the curve's 255-wide scale rather than
// the full +/-255: at full scale, moderate slider values already turn a page
// solid white or black, which makes the slider feel broken.
const ADJUSTMENT_SCALE = 1.5;

export function applyAdjustments(imageData: ImageData, brightness: number, contrast: number): ImageData {
  if (brightness === 0 && contrast === 0) return imageData;

  const c = Math.max(-100, Math.min(100, contrast)) * ADJUSTMENT_SCALE;
  const offset = Math.max(-100, Math.min(100, brightness)) * ADJUSTMENT_SCALE;
  const factor = (259 * (c + 255)) / (255 * (259 - c));

  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = factor * (v - 128) + 128 + offset;

  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  return imageData;
}

// Mutates imageData in place and returns it, for convenient chaining.
export function applyEnhancement(imageData: ImageData, mode: EnhancementMode): ImageData {
  switch (mode) {
    case "original":
      return imageData;
    case "grayscale":
      toGray(imageData);
      return imageData;
    case "auto":
      toGray(imageData);
      autoLevels(imageData);
      return imageData;
    case "bw":
      binarize(imageData);
      return imageData;
  }
}
