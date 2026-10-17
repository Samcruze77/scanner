"use client";

// Turns an uploaded PDF into scanner-workspace pages: every PDF page is
// rendered to a JPEG (the same "immutable original" shape as a photo), so it
// can then be cropped, rotated, enhanced, reordered and exported through the
// exact same pipeline as a scanned photo. Pages are handed over one at a time
// as they finish, so the UI fills in progressively and memory stays flat.

import { MAX_PDF_FILE_BYTES, openPdfData, PdfError } from "@/utils/pdf/pdfjs";
import { registerSourcePdf } from "./sourcePdfs";
import { renderPdfPage } from "@/utils/pdf/render";
import type { CapturedImage } from "./image";

// Long side of the rendered page in pixels; matches the cap applied to photos
// (see image.ts) -- roughly 170 DPI for A4.
const TARGET_LONG_SIDE_PX = 2000;

export const MAX_IMPORT_PAGES = 50;

export interface ImportPdfOptions {
  onPage: (page: CapturedImage, pageNumber: number, pageCount: number) => void;
  signal?: AbortSignal;
}

export async function importPdfPages(file: File, options: ImportPdfOptions): Promise<number> {
  if (file.size > MAX_PDF_FILE_BYTES) throw new PdfError("pdf_too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // pdf.js takes ownership of the buffer it is given, so keep our own copy: the export re-uses the
  // original pages (see pdfExport.ts).
  const fileId = registerSourcePdf(bytes.slice());
  const { doc, destroy } = await openPdfData(bytes, { maxPages: MAX_IMPORT_PAGES });
  let imported = 0;
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (options.signal?.aborted) break;
      const page = await doc.getPage(pageNumber);
      try {
        const rendered = await renderPdfPage(page, TARGET_LONG_SIDE_PX);
        options.onPage({ id: crypto.randomUUID(), ...rendered, source: { fileId, pageIndex: pageNumber - 1 } }, pageNumber, doc.numPages);
        imported++;
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await destroy();
  }
  return imported;
}
