"use client";

// Turns each kind of open document into the page images the print layer needs.
// The scanner workspace already holds its pages as images (crop, rotation,
// enhancement done); PDFs are drawn with the PDF.js the app already ships; a
// picture is a single page. Nothing here leaves the device.

import { flattenPageToJpeg } from "@/utils/scanner/annotationRender";
import type { ScannerPage } from "@/utils/scanner/page";
import { openPdfData, PdfError } from "@/utils/pdf/pdfjs";
import { renderPdfPage } from "@/utils/pdf/render";
import { MAX_PRINT_PAGES, PrintError, type PrintPage } from "./printPages";

// Long side of a printed PDF page in pixels: about 240 dpi on A4, which keeps
// text crisp without holding huge canvases in memory.
const PDF_PRINT_LONG_SIDE_PX = 2800;
const PDF_PRINT_JPEG_QUALITY = 0.92;

// "Q3 report.pdf" -> "Q3 report": the suggested print job name.
export function printTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "document";
}

// The scanner's pages exactly as the PDF would contain them: the processed
// image, with any text, signatures and marks flattened on top.
export async function scannerPagesToPrintPages(pages: ScannerPage[]): Promise<PrintPage[]> {
  const out: PrintPage[] = [];
  for (const page of pages) {
    const src = page.annotations.length > 0 ? await flattenPageToJpeg(page) : page.processedDataUrl;
    out.push({ src, width: page.processedWidth, height: page.processedHeight });
  }
  return out;
}

// Every page of a PDF, at its real size.
export async function pdfToPrintPages(pdf: Blob | Uint8Array, options: { maxPages?: number } = {}): Promise<PrintPage[]> {
  const bytes = pdf instanceof Uint8Array ? pdf : new Uint8Array(await pdf.arrayBuffer());
  let opened;
  try {
    opened = await openPdfData(bytes, { maxPages: options.maxPages ?? MAX_PRINT_PAGES });
  } catch (error) {
    if (error instanceof PdfError) {
      if (error.code === "pdf_password") throw new PrintError("password");
      if (error.code === "pdf_too_many_pages") throw new PrintError("too_many_pages");
    }
    throw new PrintError("render_failed");
  }
  try {
    const out: PrintPage[] = [];
    for (let n = 1; n <= opened.doc.numPages; n++) {
      const page = await opened.doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        const rendered = await renderPdfPage(page, PDF_PRINT_LONG_SIDE_PX, PDF_PRINT_JPEG_QUALITY);
        out.push({ src: rendered.dataUrl, width: rendered.width, height: rendered.height, widthPt: base.width, heightPt: base.height });
      } finally {
        page.cleanup();
      }
    }
    return out;
  } catch (error) {
    throw error instanceof PrintError ? error : new PrintError("render_failed");
  } finally {
    await opened.destroy();
  }
}

// A picture is one page, printed from the file itself so no quality is lost.
export async function imageToPrintPages(image: Blob): Promise<PrintPage[]> {
  const url = URL.createObjectURL(image);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return [{ src: url, width: img.naturalWidth, height: img.naturalHeight }];
  } catch {
    URL.revokeObjectURL(url);
    throw new PrintError("render_failed");
  }
}
