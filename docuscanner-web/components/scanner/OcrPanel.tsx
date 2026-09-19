"use client";

import { useEffect, useRef, useState } from "react";
import type { ScannerPage } from "@/utils/scanner/page";
import { OCR_LOW_CONFIDENCE_THRESHOLD } from "@/utils/ocr/config";
import { isRetryableOcrError, ocrErrorMessage } from "@/utils/ocr/messages";
import type { OcrDocumentResult, OcrErrorCode, OcrProgress } from "@/utils/ocr/types";
import { OcrTextEditor } from "./OcrTextEditor";
import type { OcrController } from "./useOcr";

const BUTTON = "min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700";

// Tracks the *visible* area so that, on phones, the on-screen keyboard shrinks
// the panel instead of covering it -- the header (Copy / Close) and the search
// box stay reachable while typing.
function useVisibleViewport(): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(() =>
    typeof window !== "undefined" && window.visualViewport
      ? { top: window.visualViewport.offsetTop, height: window.visualViewport.height }
      : null,
  );
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setBox({ top: viewport.offsetTop, height: viewport.height });
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return box;
}

function progressView(progress: OcrProgress | null): { percent: number; label: string } {
  if (!progress || progress.phase === "loading_engine") {
    const load = progress?.fraction ?? 0;
    return { percent: Math.round(load * 20), label: `Loading text engine… ${Math.round(load * 100)}%` };
  }
  const overall = (progress.pageIndex + progress.fraction) / progress.pageCount;
  const percent = Math.round((0.2 + 0.8 * overall) * 100);
  const where = progress.pageCount > 1 ? `page ${progress.pageIndex + 1} of ${progress.pageCount}` : "page";
  return { percent, label: `Reading ${where}… ${percent}%` };
}

function summarizeNotices(result: OcrDocumentResult, errorCodes: OcrErrorCode[], maxPagesPerRun: number): string[] {
  const notices: string[] = [];
  const failed = result.pages.filter((p) => p.status === "error");
  if (failed.length > 0) {
    const list = failed.map((p) => p.pageNumber).join(", ");
    notices.push(
      `Couldn't read page ${list}. ${ocrErrorMessage(errorCodes[0] ?? "ocr_failed", maxPagesPerRun)} The rest of the text is shown below.`,
    );
  }
  if (result.pages.length > 1) {
    const empty = result.pages.filter((p) => p.status === "empty").map((p) => p.pageNumber);
    if (empty.length > 0) notices.push(`No text found on page ${empty.join(", ")}.`);
  }
  const shaky = result.pages
    .filter((p) => p.status === "done" && p.confidence !== null && p.confidence < OCR_LOW_CONFIDENCE_THRESHOLD)
    .map((p) => p.pageNumber);
  if (shaky.length > 0) {
    notices.push(
      `Page ${shaky.join(", ")} may contain mistakes. A sharper, well-lit photo or the Black & White enhancement usually helps.`,
    );
  }
  return notices;
}

export function OcrPanel({ ocr, pages }: { ocr: OcrController; pages: ScannerPage[] }) {
  const { state, text, closePanel } = ocr;
  const viewport = useVisibleViewport();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const copyTimer = copyTimerRef;
    return () => {
      document.body.style.overflow = previousOverflow;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePanel]);

  async function handleCopy() {
    const ok = await ocr.copy();
    setCopyStatus(ok ? "copied" : "failed");
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyStatus("idle"), 2500);
  }

  const done = state.status === "done" && state.result.pages.some((p) => p.text) ? state : null;
  const noText = state.status === "done" && !done;
  const stale = done ? ocr.isStale(pages) : false;
  const notices = done ? summarizeNotices(done.result, done.errorCodes, ocr.limits.maxPagesPerRun) : [];
  const previews = done
    ? done.result.pages
        .map((read) => ({ read, page: pages.find((p) => p.id === read.pageId) }))
        .filter((entry): entry is { read: (typeof entry)["read"]; page: ScannerPage } => entry.page !== undefined)
    : [];
  const pageCount = done?.result.pages.length ?? 0;
  const closeLabel = state.status === "running" ? "Cancel text extraction" : "Close";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Extracted text"
      className="fixed inset-0 z-50 flex bg-black/60 sm:items-center sm:justify-center sm:p-4"
      style={viewport ? { top: viewport.top, height: viewport.height } : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget && state.status !== "running") closePanel();
      }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden bg-white dark:bg-zinc-900 sm:h-[90vh] sm:max-h-[48rem] sm:max-w-5xl sm:rounded-xl">
        <div className="flex items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">Extracted text</h2>
            {done && (
              <p className="truncate text-xs text-zinc-500">
                {pageCount} page{pageCount === 1 ? "" : "s"} · English
              </p>
            )}
          </div>
          {done && (
            <button
              type="button"
              onClick={handleCopy}
              className="min-h-11 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
              disabled={text.length === 0}
            >
              {copyStatus === "copied" ? "Copied ✓" : "Copy text"}
            </button>
          )}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closePanel}
            aria-label={closeLabel}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {copyStatus === "copied" ? "Text copied to clipboard" : ""}
        </div>

        {state.status === "running" &&
          (() => {
            const { percent, label } = progressView(state.progress);
            return (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-label="Text extraction progress"
                  className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                >
                  <div
                    className="h-full rounded-full bg-zinc-900 transition-[width] duration-300 dark:bg-white"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p role="status" className="text-sm font-medium">
                  {label}
                </p>
                <p className="max-w-sm text-xs text-zinc-500">
                  Text is read on your device -- your document is never uploaded. The first run downloads the text
                  engine, so it can take a little longer.
                </p>
                <button type="button" onClick={ocr.reset} className={BUTTON}>
                  Cancel
                </button>
              </div>
            );
          })()}

        {state.status === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <p role="alert" className="max-w-md text-sm">
              {ocrErrorMessage(state.code, ocr.limits.maxPagesPerRun)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {isRetryableOcrError(state.code) && (
                <button
                  type="button"
                  onClick={ocr.retry}
                  className="min-h-11 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-black"
                >
                  Try again
                </button>
              )}
              <button type="button" onClick={closePanel} className={BUTTON}>
                Close
              </button>
            </div>
          </div>
        )}

        {noText && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <p role="status" className="text-sm font-medium">
              No text found.
            </p>
            <p className="max-w-md text-sm text-zinc-500">
              Text extraction works best on printed text in English. Make sure the page is upright, well lit and in
              focus, then try the Black &amp; White enhancement.
            </p>
            <button type="button" onClick={closePanel} className={BUTTON}>
              Close
            </button>
          </div>
        )}

        {done && (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside
              aria-label="Scanned pages"
              className="hidden w-64 shrink-0 space-y-3 overflow-y-auto border-r border-zinc-200 p-3 dark:border-zinc-800 md:block lg:w-80"
            >
              {previews.map(({ read, page }) => (
                <figure key={read.pageId} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
                  <img
                    src={page.processedDataUrl}
                    alt={`Page ${read.pageNumber} preview`}
                    className="w-full rounded-md border border-zinc-200 object-contain dark:border-zinc-800"
                  />
                  <figcaption className="text-xs text-zinc-500">Page {read.pageNumber}</figcaption>
                </figure>
              ))}
            </aside>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              {stale && (
                <div role="status" className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  <span className="min-w-0 flex-1">The pages changed after this text was extracted.</span>
                  <button type="button" onClick={() => ocr.rerun(pages)} className={BUTTON}>
                    Extract again
                  </button>
                </div>
              )}
              {copyStatus === "failed" && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  Couldn&apos;t copy automatically. Use Select all, then copy.
                </p>
              )}
              {notices.map((notice) => (
                <p key={notice} className="rounded-md bg-zinc-100 p-3 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                  {notice}
                </p>
              ))}
              <OcrTextEditor
                text={text}
                edited={text !== done.result.documentText}
                onTextChange={ocr.setText}
                onRestore={ocr.restoreOriginalText}
                onDownload={ocr.download}
                onDiscard={ocr.reset}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
