"use client";

// Optional "save my signature on this device". A signature is personal, so this
// is strictly opt-in and strictly local: it is kept in this browser's own
// storage only, never uploaded, never sent to analytics, and can be removed at
// any time. Every access is wrapped because storage can be unavailable or blocked
// (private windows, strict settings) and the app must work without it.

import type { SignatureImage } from "./signature";

const KEY = "docuscanner.signature.v1";
// A drawn/typed/uploaded signature is a small PNG; anything far bigger isn't one.
const MAX_STORED_CHARS = 600_000;

function isSignature(value: unknown): value is SignatureImage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.dataUrl === "string" &&
    v.dataUrl.startsWith("data:image/png;base64,") &&
    v.dataUrl.length <= MAX_STORED_CHARS &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    v.width > 0 &&
    v.height > 0
  );
}

export function loadSavedSignature(): SignatureImage | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSignature(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Returns whether it was saved (it won't be if storage is full or blocked).
export function saveSignature(signature: SignatureImage): boolean {
  if (signature.dataUrl.length > MAX_STORED_CHARS) return false;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ dataUrl: signature.dataUrl, width: signature.width, height: signature.height }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearSavedSignature(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; there was nothing we could store either.
  }
}
