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
import {
  convertPdfToExcel,
  type PdfToExcelLayout,
  type PdfToExcelProgress,
  type PdfToExcelResult,
} from "@/utils/convert/pdfToExcel";
import { downloadBlob, outputFilename } from "@/utils/convert/download";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import { getOcrLimits } from "@/utils/ocr/config";
import { ocrErrorMessage } from "@/utils/ocr/messages";
import { OcrCancelledError, OcrError } from "@/utils/ocr/types";
import { isPdfFile, PdfError } from "@/utils/pdf/pdfjs";
import { pdfImportErrorMessage } from "@/utils/scanner/errorMessages";
import { FileDropzone } from "./FileDropzone";

const LAYOUTS: { value: PdfToExcelLayout; label: string; hint: string }[] = [
  { value: "sheet-per-page", label: "One sheet per page", hint: "Best when each page has its own table." },
  { value: "single-sheet", label: "All pages on one sheet", hint: "Best for one table that runs across pages." },
];

// Used at the start of a sentence, e.g. "Pages 2, 4 had no selectable text".
function describePages(pages: number[]): string {
  return `${pages.length === 1 ? "Page" : "Pages"} ${pages.join(", ")}`;
}

function progressLabel(progress: PdfToExcelProgress): string {
  if (progress.phase === "reading") return `Reading page ${progress.page} of ${progress.pageCount}…`;
  return progress.fraction === 0
    ? "Loading text recognition…"
    : `Reading scanned pages… ${Math.round(progress.fraction * 100)}%`;
}

export function PdfToExcelTool() {
  const { user } = useAuth();
  const plan = getUserPlan(user);
  const available = isFeatureAvailable("convert.pdf_to_excel", plan);
  const ocrEnabled = isFeatureAvailable("ocr.basic", plan);

  const [file, setFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<PdfToExcelLayout>("sheet-per-page");
  const [progress, setProgress] = useState<PdfToExcelProgress | null>(null);
  const [result, setResult] = useState<PdfToExcelResult | null>(null);
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
      void trackError("pdf_to_excel", "unsupported_file_type");
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
    void trackConversionStarted("pdf_to_excel");
    try {
      const converted = await convertPdfToExcel(file, {
        layout,
        plan,
        ocrEnabled,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (converted.ocrPages.length > 0) void trackFeatureUsed("ocr", { source: "pdf_to_excel" });
      void trackConversionCompleted("pdf_to_excel", Date.now() - startedAt);
      setResult(converted);
    } catch (err) {
      const cancelled =
        (err instanceof DOMException && err.name === "AbortError") || err instanceof OcrCancelledError;
      if (!cancelled) {
        if (err instanceof PdfError) {
          setError(pdfImportErrorMessage(err.code));
          void trackError("pdf_to_excel", err.code);
        } else if (err instanceof OcrError) {
          setError(ocrErrorMessage(err.code, getOcrLimits(plan).maxPagesPerRun));
          void trackError("ocr", err.code);
        } else {
          setError("Couldn't convert that PDF. Please try again.");
          void trackError("pdf_to_excel", "conversion_failed");
        }
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  function handleDownload() {
    if (!result || !file) return;
    downloadBlob(result.blob, outputFilename(file.name, "xlsx"));
    void trackDocumentDownloaded("xlsx");
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

          <fieldset disabled={converting} className="space-y-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Layout</legend>
            {LAYOUTS.map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 items-start gap-3 rounded-md border border-zinc-200 px-3 py-2.5 text-sm dark:border-zinc-800"
              >
                <input
                  type="radio"
                  name="layout"
                  checked={layout === option.value}
                  onChange={() => {
                    setLayout(option.value);
                    setResult(null);
                  }}
                  className="mt-0.5 h-4 w-4 accent-blue-600"
                />
                <span>
                  <span className="font-medium">{option.label}</span>
                  <span className="block text-zinc-500">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <p className="text-sm text-zinc-500">
            Works best on PDFs made from spreadsheets, invoices and reports, where the text is selectable.
            {ocrEnabled
              ? " Scanned pages are read with text recognition instead and come out one line per row."
              : ""}
          </p>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {result ? (
              <>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
                >
                  Download Excel file
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
                {converting ? "Converting…" : "Convert to Excel"}
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
                  Done: {result.rowCount} row{result.rowCount === 1 ? "" : "s"} in {result.sheetCount} sheet
                  {result.sheetCount === 1 ? "" : "s"}.
                </p>
                {result.ocrPages.length > 0 && (
                  <p>
                    {describePages(result.ocrPages)} had no selectable text, so {result.ocrPages.length === 1 ? "it was" : "they were"} read
                    with text recognition (one line per row; please check the wording).
                  </p>
                )}
                {result.unreadPages.length > 0 && (
                  <p>
                    {describePages(result.unreadPages)} had no readable text and{" "}
                    {result.unreadPages.length === 1 ? "was" : "were"} left out.
                  </p>
                )}
                <p>Table detection is automatic, so give the columns a quick check before you rely on them.</p>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Preview (first {result.preview.length} rows)
                </p>
                <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full min-w-max border-collapse text-left text-sm">
                    <tbody>
                      {result.preview.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                          {row.length === 0 ? (
                            <td className="px-3 py-1.5">&nbsp;</td>
                          ) : (
                            row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="max-w-56 truncate px-3 py-1.5">
                                {cell}
                              </td>
                            ))
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
