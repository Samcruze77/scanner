"use client";

// Opt-in scanner diagnostics for real-device testing. Active in development, or
// in production only when the page URL has ?camdebug=1. Normal users never
// trigger it: every call is a no-op and nothing is stored or shown.

export interface DebugEntry {
  at: string;
  kind: string;
  data: unknown;
}

export const SCANNER_DEBUG_EVENT = "scanner-debug";

type DebugWindow = Window & { __scannerDiag?: DebugEntry[] };

export function isScannerDebug(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV !== "production") return true;
  try {
    return new URLSearchParams(window.location.search).has("camdebug");
  } catch {
    return false;
  }
}

export function debugLog(kind: string, data: unknown): void {
  if (!isScannerDebug()) return;
  const entry: DebugEntry = { at: new Date().toISOString(), kind, data };
  const w = window as DebugWindow;
  (w.__scannerDiag ??= []).push(entry);
  console.info("[scanner]", kind, data);
  window.dispatchEvent(new CustomEvent(SCANNER_DEBUG_EVENT, { detail: entry }));
}

export function readDebugLog(): DebugEntry[] {
  if (typeof window === "undefined") return [];
  return (window as DebugWindow).__scannerDiag ?? [];
}

// Approximate decoded size of a base64 data URL.
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return Math.round(((dataUrl.length - comma - 1) * 3) / 4);
}
