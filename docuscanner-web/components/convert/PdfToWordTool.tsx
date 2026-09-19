"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ErrorBanner } from "@/components/scanner/ErrorBanner";
import {
  trackConversionCompleted,
  trackConversionStarted,
  trackDocumentDownloaded,
  trackDocumentUploaded,
  trackError,
  trackFeatureUsed,
} from "@/utils/analytics/events";
import type { PdfToWordProgress, PdfToWordResult } from "@/utils/convert/pdfToWord";
import { downloadBlob, outputFilename } from "@/utils/convert/download";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import { getOcrLimits } from "@/utils/ocr/config";
import { ocrErrorMessage } from "@/utils/ocr/messages";
import { OcrCancelledError, OcrError } from "@/utils/ocr/types";
import { isPdfFile, PdfError } from "@/utils/pdf/pdfjs";
import { pdfImportErrorMessage } from "@/utils/scanner/errorMessages";
import { FileDropzone } from "./FileDropzone";

// Same wording as the PDF -> Excel tool for shared cases.
function describePages(pages: number[]): string {
  return `${pages.length === 1 ? "Page" : "Pages"} ${pages.join(", ")}`;
}

function progressLabel(progress: PdfToWordProgress): string {
  if (progress.phase === "reading") return `Reading page ${progress.page} of ${progress.pageCount}…`;
  if (progress.phase === "building") return "Building the Word document…";
  return progress.fraction === 0
    ? "Loading text recognition…"
    : `Reading scanned pages… ${Math.round(progress.fraction * 100)}%`;
}

const KIND_LABELS = { heading: "Heading", paragraph: "Paragraph", list: "List item", table: "Table" } as const;

export function PdfToWordTool() {
  const { user } = useAuth();
  const plan = getUserPlan(user);
  const available = isFeatureAvailable("convert.pdf_to_word", plan);
  const ocrEnabled = isFeatureAvailable("ocr.basic", plan);

  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<PdfToWordProgress | null>(null);
  const [result, setResult] = useState<PdfToWordResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!available) {
    return <p className="text-sm text-zinc-500">This tool isn&apos;t available on your plan.</p>;
  }

  const converting = progress !== null;

  function handleFile(chosen: File) {
    setError(null);
    setResult(null);
    if (!isPdfFile(chosen)) {
      setError("That file isn't a PDF. Please choose a PDF file.");
      void trackError("pdf_to_word", "unsupported_file_type");
      return;
    }
    void trackDocumentUploaded(chosen.type || "application/pdf", chosen.size);
    setFile(chosen);
  }

  async function handleConvert() {
    if (!file || converting) return;
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ phase: "reading", page: 1, pageCount: 1 });

    const startedAt = Date.now();
    void trackConversionStarted("pdf_to_word");
    try {
      // The converter (PDF.js, the Word writer, and OCR when needed) is large,
      // so it loads only once a conversion actually starts.
      const { convertPdfToWord } = await import("@/utils/convert/pdfToWord");
      const converted = await convertPdfToWord(file, {
        plan,
        ocrEnabled,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (converted.ocrPages.length > 0) void trackFeatureUsed("ocr", { source: "pdf_to_word" });
      void trackConversionCompleted("pdf_to_word", Date.now() - startedAt);
      setResult(converted);
    } catch (err) {
      const cancelled =
        (err instanceof DOMException && err.name === "AbortError") || err instanceof OcrCancelledError;
      if (!cancelled) {
        if (err instanceof PdfError) {
          setError(pdfImportErrorMessage(err.code));
          void trackError("pdf_to_word", err.code);
        } else if (err instanceof OcrError) {
          setError(ocrErrorMessage(err.code, getOcrLimits(plan).maxPagesPerRun));
          void trackError("ocr", err.code);
        } else {
          setError("Couldn't convert that PDF. Please try again.");
          void trackError("pdf_to_word", "conversion_failed");
        }
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  function handleDownload() {
    if (!result || !file) return;
    downloadBlob(result.blob, outputFilename(file.name, "docx"));
    void trackDocumentDownloaded("docx");
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {!file ? (
        <FileDropzone
          accept="application/pdf,.pdf"
          title="Choose a PDF"
          hint="or drop it here. Your file stays on your device."
          onFile={handleFile}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="min-w-0 truncate text-sm font-medium">{file.name}</p>
            <button
              type="button"
              disabled={converting}
              onClick={() => {
                setFile(null);
                setResult(null);
                setError(null);
              }}
              className="min-h-11 rounded-md px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Choose a different file
            </button>
          </div>

          <div
            role="note"
            className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            <p className="font-medium">Complex layouts may not convert perfectly</p>
            <p>
              Headings, paragraphs, lists, tables and text styles are rebuilt from the PDF, so the Word file is
              editable. Columns, text around pictures and exact spacing usually change, and pictures in the PDF
              aren&apos;t copied.
              {ocrEnabled ? " Scanned pages are read with text recognition, so please check the wording." : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {result ? (
              <>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
                >
                  Download Word file
                </button>
                <button
                  type="button"
                  onClick={handleConvert}
                  className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700"
                >
                  Convert again
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConvert}
                disabled={converting}
                className="min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
              >
                {converting ? "Converting…" : "Convert to Word"}
              </button>
            )}
            {converting && (
              <>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="min-h-11 rounded-md px-4 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <p role="status" className="text-sm text-zinc-500">
                  {progress ? progressLabel(progress) : ""}
                </p>
              </>
            )}
          </div>

          {result && (
            <div className="space-y-3">
              <div
                role="status"
                className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              >
                <p className="font-medium">
                  Done: {result.pageCount} page{result.pageCount === 1 ? "" : "s"}, with {result.stats.headings}{" "}
                  heading{result.stats.headings === 1 ? "" : "s"}, {result.stats.paragraphs} paragraph
                  {result.stats.paragraphs === 1 ? "" : "s"}, {result.stats.listItems} list item
                  {result.stats.listItems === 1 ? "" : "s"} and {result.stats.tables} table
                  {result.stats.tables === 1 ? "" : "s"}.
                </p>
                {result.ocrPages.length > 0 && (
                  <p>
                    {describePages(result.ocrPages)} had no selectable text, so {result.ocrPages.length === 1 ? "it was" : "they were"}{" "}
                    read with text recognition and added as plain paragraphs (please check the wording).
                  </p>
                )}
                {result.unreadPages.length > 0 && (
                  <p>
                    {describePages(result.unreadPages)} had no readable text and{" "}
                    {result.unreadPages.length === 1 ? "was" : "were"} left out.
                  </p>
                )}
                <p>Open the file in Word and check the layout before you rely on it.</p>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  What was rebuilt (first {result.preview.length} items)
                </p>
                <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-900 dark:border-zinc-800">
                  {result.preview.map((line, index) => (
                    <li key={index} className="flex gap-3 px-3 py-1.5">
                      <span className="w-20 shrink-0 text-xs text-zinc-500">{KIND_LABELS[line.kind]}</span>
                      <span className="min-w-0 truncate">{line.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
