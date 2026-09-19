import type { OcrErrorCode } from "./types";

// User-facing copy for OCR failures. The codes themselves are what get sent to
// analytics, so neither the codes nor the copy may contain anything from the
// document.

export function ocrErrorMessage(code: OcrErrorCode, maxPagesPerRun: number): string {
  switch (code) {
    case "too_many_pages":
      return `Basic text extraction reads up to ${maxPagesPerRun} pages at a time. Remove some pages, or extract text from pages one at a time.`;
    case "unsupported_image":
      return "This page's image couldn't be read. Try scanning it again.";
    case "engine_load_failed":
      return "The text engine couldn't be loaded. Check your connection and try again. Scanning and PDF creation still work.";
    case "ocr_timeout":
      return "Reading this page took too long. Try again, or extract fewer pages at a time.";
    case "out_of_memory":
      return "Your device ran out of memory while reading. Close other tabs, or extract one page at a time.";
    case "ocr_failed":
      return "Text extraction didn't work this time. Try again. Scanning and PDF creation aren't affected.";
  }
}

// Failures worth offering a "Try again" for.
export function isRetryableOcrError(code: OcrErrorCode): boolean {
  return code !== "too_many_pages" && code !== "unsupported_image";
}
