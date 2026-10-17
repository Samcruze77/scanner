"use client";

// Turns each kind of open document into the page images the print layer needs.
// The scanner workspace already holds its pages as images (crop, rotation,
// enhancement done); PDFs are drawn with the PDF.js the app already ships; a
// picture is a single page. Nothing here leaves the device.

import { buildPageLayers, flattenPageToJpeg } from "@/utils/scanner/annotationRender";
import { canPreserveSource } from "@/utils/scanner/pdfExport";
import { getSourcePdf } from "@/utils/scanner/sourcePdfs";
import type { ScannerPage } from "@/utils/scanner/page";
import { openPdfData, PdfError, type OpenedPdf } from "@/utils/pdf/pdfjs";
import { renderPdfPage } from "@/utils/pdf/render";
import { MAX_PRINT_PAGES, PrintError, type PrintPage } from "./printPages";

// Long side of a printed PDF page in pixels: about 240 dpi on A4, which keeps
// text crisp without holding huge canvases in memory.
const PDF_PRINT_LONG_SIDE_PX = 2800;
const PDF_PRINT_JPEG_QUALITY = 0.92;

// Source PDF pages that have not been pixel-edited are printed from the ORIGINAL PDF, drawn by pdf.js at
// about 300 dpi for the page's real size (never below 1800 px or above 3600 px on the long side, which
// bounds memory), instead of from the ~170 dpi page image used on screen. Edits (text, marks, pictures)
// are laid on top exactly as in the exported PDF. A printed page is still a picture of the page (the
// browser's print layer takes images, not PDF content): for selectable text and vector lines, download
// the PDF. Renders are cached per page so changing one page does not redraw the others.
const PRINT_DPI = 300;
const PRINT_MIN_SIDE_PX = 1800;
const PRINT_MAX_SIDE_PX = 3600;
const PRINT_JPEG_QUALITY = 0.9;
const printCache = new Map<string, { dataUrl: string; width: number; height: number }>();
const PRINT_CACHE_LIMIT = 40;

async function sourceRenderForPrint(page: ScannerPage, opened: Map<string, OpenedPdf>): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!page.source || !page.ptPerPx || !canPreserveSource(page)) return null;
  const longPt = Math.max(page.processedWidth, page.processedHeight) * page.ptPerPx;
  const longSide = Math.min(PRINT_MAX_SIDE_PX, Math.max(PRINT_MIN_SIDE_PX, Math.ceil((longPt / 72) * PRINT_DPI)));
  const key = `${page.source.fileId}:${page.source.pageIndex}:${page.rotation}:${longSide}`;
  const cached = printCache.get(key);
  if (cached) return cached;
  let doc = opened.get(page.source.fileId);
  if (!doc) {
    const bytes = getSourcePdf(page.source.fileId);
    if (!bytes) return null;
    // pdf.js takes ownership of the buffer it is given, so it gets a copy.
    doc = await openPdfData(bytes.slice());
    opened.set(page.source.fileId, doc);
  }
  const pdfPage = await doc.doc.getPage(page.source.pageIndex + 1);
  try {
    const rendered = await renderPdfPage(pdfPage, longSide, PRINT_JPEG_QUALITY, page.rotation, 8);
    if (printCache.size >= PRINT_CACHE_LIMIT) printCache.delete(printCache.keys().next().value as string);
    printCache.set(key, rendered);
    return rendered;
  } finally {
    pdfPage.cleanup();
  }
}

// "Q3 report.pdf" -> "Q3 report": the suggested print job name.
export function printTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "document";
}

// The scanner's pages exactly as the PDF would contain them: the processed
// image, with any text, signatures and marks flattened on top.
export async function scannerPagesToPrintPages(pages: ScannerPage[]): Promise<PrintPage[]> {
  const out: PrintPage[] = [];
  const opened = new Map<string, OpenedPdf>();
  try {
  for (const original of pages) {
    let page = original;
    try {
      const hi = await sourceRenderForPrint(original, opened);
      // Same page, same normalized annotations, but drawn on the sharper render.
      if (hi) page = { ...original, processedDataUrl: hi.dataUrl, processedWidth: hi.width, processedHeight: hi.height };
    } catch {
      page = original; // fall back to the on-screen page image
    }
    // Pages with inserted pictures print as layers (the page image plus each picture at its
    // own resolution), the same way the PDF is made; others are flattened as before.
    const layers = await buildPageLayers(page);
    if (layers) {
      const [base, ...rest] = layers;
      out.push({ src: base.dataUrl, width: page.processedWidth, height: page.processedHeight, layers: rest.map((l) => ({ src: l.dataUrl, x: l.x, y: l.y, w: l.w, h: l.h })) });
      continue;
    }
    const src = page.annotations.length > 0 ? await flattenPageToJpeg(page) : page.processedDataUrl;
    out.push({ src, width: page.processedWidth, height: page.processedHeight });
  }
  } finally {
    // The PDFs opened for sharper renders are closed; the renders themselves stay cached.
    await Promise.all([...opened.values()].map((d) => d.destroy().catch(() => undefined)));
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
