"use client";

// Single place that loads and configures PDF.js. Used by PDF import (render
// pages into the scanner workspace) and PDF -> Excel (read text positions).
// PDF.js is dynamically imported so it only lands in the bundle of users who
// actually open a PDF, and its worker/fonts/CMaps are self-hosted under
// /pdfjs (see scripts/copy-pdf-assets.mjs) -- nothing is fetched from a CDN
// and no file ever leaves the browser.

import type { PDFDocumentProxy } from "pdfjs-dist";

const PDFJS_BASE = "/pdfjs";

export const MAX_PDF_FILE_BYTES = 25 * 1024 * 1024;

export type PdfErrorCode =
  | "pdf_password"
  | "pdf_invalid"
  | "pdf_too_large"
  | "pdf_too_many_pages"
  | "pdf_no_text"
  | "pdf_failed";

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode) {
    super(code);
    this.name = "PdfError";
    this.code = code;
  }
}

type PdfjsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    // The legacy build runs on older mobile browsers the modern one doesn't.
    pdfjsPromise = (import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfjsModule>)
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
        return pdfjs;
      })
      .catch((error) => {
        // Let a later attempt retry instead of caching the failure.
        pdfjsPromise = null;
        throw error;
      });
  }
  return pdfjsPromise;
}

function classifyOpenError(error: unknown): PdfError {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return new PdfError("pdf_password");
  if (name === "InvalidPDFException" || name === "FormatError") return new PdfError("pdf_invalid");
  return new PdfError("pdf_failed");
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  // Frees the document and its worker memory. Callers own this and must call
  // it when finished (put it in a `finally`).
  destroy: () => Promise<void>;
}

// Opens a PDF from a user-selected file.
export async function openPdf(file: File, options: { maxPages?: number } = {}): Promise<OpenedPdf> {
  if (file.size > MAX_PDF_FILE_BYTES) throw new PdfError("pdf_too_large");
  return openPdfData(new Uint8Array(await file.arrayBuffer()), options);
}

// Opens a PDF from bytes the caller already holds (no size cap of its own: the
// caller decides what is acceptable for its purpose).
export async function openPdfData(data: Uint8Array, options: { maxPages?: number } = {}): Promise<OpenedPdf> {
  let pdfjs: PdfjsModule;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    throw new PdfError("pdf_failed");
  }

  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${PDFJS_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
    wasmUrl: `${PDFJS_BASE}/wasm/`,
  });

  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    void task.destroy();
    throw classifyOpenError(error);
  }

  if (options.maxPages !== undefined && doc.numPages > options.maxPages) {
    void task.destroy();
    throw new PdfError("pdf_too_many_pages");
  }
  return { doc, destroy: () => task.destroy() };
}
