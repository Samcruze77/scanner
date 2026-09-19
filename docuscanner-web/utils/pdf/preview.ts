"use client";

import { openPdf } from "./pdfjs";
import { renderPdfPage } from "./render";

export interface PdfSummary {
  pageCount: number;
  // First page as a small JPEG data URL, for an on-screen preview.
  previewDataUrl: string | null;
}

// Reads back a PDF this app just produced: how many pages it has and what the
// first one looks like, so people can see the result before downloading it.
export async function summarizePdf(blob: Blob): Promise<PdfSummary> {
  const { doc, destroy } = await openPdf(new File([blob], "preview.pdf", { type: "application/pdf" }));
  try {
    let previewDataUrl: string | null = null;
    try {
      const page = await doc.getPage(1);
      try {
        previewDataUrl = (await renderPdfPage(page, 900, 0.8)).dataUrl;
      } finally {
        page.cleanup();
      }
    } catch {
      // A missing preview is not worth failing the conversion for.
    }
    return { pageCount: doc.numPages, previewDataUrl };
  } finally {
    await destroy();
  }
}
