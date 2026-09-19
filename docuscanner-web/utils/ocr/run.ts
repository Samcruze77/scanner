"use client";

// Runs OCR over a set of scanner pages, strictly one page at a time and in
// the order given, so memory stays flat regardless of page count and the
// per-page results line up with the document. A page that can't be read is
// recorded and skipped; failures that take the engine down (timeout, out of
// memory) end the run but keep whatever was already extracted.

import type { ScannerPage } from "@/utils/scanner/page";
import { OCR_LANGUAGE, type OcrLimits } from "./config";
import { classifyOcrError, loadOcrEngine, type OcrEngine } from "./engine";
import { ocrSourceKey, prepareOcrImage, releaseCanvas } from "./preprocess";
import { combinePageText, normalizeOcrText } from "./text";
import {
  OcrCancelledError,
  OcrError,
  type OcrDocumentResult,
  type OcrErrorCode,
  type OcrPageResult,
  type OcrProgress,
} from "./types";

export interface RunOcrOptions {
  // Pages to read, in reading order, paired with their 1-based position in
  // the whole document.
  targets: { page: ScannerPage; pageNumber: number }[];
  scope: OcrDocumentResult["scope"];
  limits: OcrLimits;
  signal?: AbortSignal;
  onProgress?: (progress: OcrProgress) => void;
}

export interface RunOcrOutcome {
  result: OcrDocumentResult;
  // Distinct error codes hit along the way (empty when everything read fine).
  errorCodes: OcrErrorCode[];
}

// Errors after which the engine is gone, so remaining pages can't be read.
const RUN_ENDING_CODES: OcrErrorCode[] = ["ocr_timeout", "out_of_memory", "ocr_failed"];

function nextPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runOcr(options: RunOcrOptions): Promise<RunOcrOutcome> {
  const { targets, scope, limits, signal, onProgress } = options;
  const pageCount = targets.length;

  let lastReported = -1;
  const report = (progress: OcrProgress) => {
    // The engine reports many times a second; only surface visible changes.
    const key = progress.pageIndex + progress.fraction;
    if (progress.fraction !== 0 && progress.fraction !== 1 && Math.abs(key - lastReported) < 0.02) return;
    lastReported = key;
    onProgress?.(progress);
  };

  report({ phase: "loading_engine", pageIndex: 0, pageCount, fraction: 0 });
  const engine: OcrEngine = await loadOcrEngine({
    timeoutMs: limits.engineLoadTimeoutMs,
    signal,
    onProgress: (fraction) => report({ phase: "loading_engine", pageIndex: 0, pageCount, fraction }),
  });

  const pages: OcrPageResult[] = [];
  const errorCodes = new Set<OcrErrorCode>();

  try {
    for (let index = 0; index < pageCount; index++) {
      if (signal?.aborted) throw new OcrCancelledError();
      const { page, pageNumber } = targets[index];
      const base = { pageId: page.id, pageNumber, sourceKey: ocrSourceKey(page) };
      report({ phase: "recognizing", pageIndex: index, pageCount, fraction: 0 });
      await nextPaint();

      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = await prepareOcrImage(page, limits.targetLongSidePx);
        const recognized = await engine.recognize(canvas, {
          timeoutMs: limits.pageTimeoutMs,
          signal,
          onProgress: (fraction) => report({ phase: "recognizing", pageIndex: index, pageCount, fraction }),
        });
        const text = normalizeOcrText(recognized.text);
        pages.push({
          ...base,
          text,
          confidence: recognized.confidence,
          status: text ? "done" : "empty",
        });
      } catch (error) {
        const classified = classifyOcrError(error, "ocr_failed");
        if (classified instanceof OcrCancelledError) throw classified;
        errorCodes.add(classified.code);
        pages.push({ ...base, text: "", confidence: null, status: "error", errorCode: classified.code });
        if (RUN_ENDING_CODES.includes(classified.code)) break;
      } finally {
        if (canvas) releaseCanvas(canvas);
      }
      report({ phase: "recognizing", pageIndex: index, pageCount, fraction: 1 });
    }
  } finally {
    await engine.terminate();
  }

  // Nothing readable at all and at least one real failure: surface the
  // failure rather than presenting an empty result as "no text found".
  if (pages.every((p) => p.status === "error")) {
    throw new OcrError(pages[0]?.errorCode ?? "ocr_failed");
  }

  return {
    result: {
      pages,
      documentText: combinePageText(pages),
      scope,
      tier: "basic",
      language: OCR_LANGUAGE,
      engine: "tesseract.js",
      createdAt: Date.now(),
    },
    errorCodes: [...errorCodes],
  };
}
