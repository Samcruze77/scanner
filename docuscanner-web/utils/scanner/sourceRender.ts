"use client";

// A page of an imported PDF that needs new pixels (grayscale, black and white, brightness, contrast, a skewed
// or "remove for good" crop) is shown on screen as a ~170 dpi picture. Exporting that picture would give a
// soft page, and cropping it would make it softer still. So at export the page is drawn AGAIN from the
// original PDF at about 300 dpi for its real size, the same crop and enhancement are applied to that sharper
// picture, and it replaces the on-screen one in the output only. The on-screen page, the original and the
// person's edit settings are untouched, so every edit stays reversible.
//
// Memory is bounded: the long side of the full-page render never exceeds MAX_RENDER_SIDE_PX, and the
// processing step caps its output at 4096 px as before. If anything fails the page is exported as it is.

import { openPdfData, type OpenedPdf } from "@/utils/pdf/pdfjs";
import { renderPdfPage } from "@/utils/pdf/render";
import { canPreserveSource } from "./pdfExport";
import type { ScannerPage } from "./page";
import { getSourcePdf } from "./sourcePdfs";

export const EXPORT_DPI = 300;
export const MAX_RENDER_SIDE_PX = 6000;
const RENDER_JPEG_QUALITY = 0.95;

// The long side, in pixels, the whole page is drawn at for export.
export function exportRenderSide(longPt: number): number {
  return Math.min(MAX_RENDER_SIDE_PX, Math.ceil((longPt / 72) * EXPORT_DPI));
}

export async function sharpenFlattenedPage(page: ScannerPage, opened: Map<string, OpenedPdf>): Promise<ScannerPage> {
  if (!page.source || !page.ptPerPx || canPreserveSource(page)) return page;
  const bytes = getSourcePdf(page.source.fileId);
  if (!bytes) return page;
  const longPt = Math.max(page.originalWidth, page.originalHeight) * page.ptPerPx;
  const side = exportRenderSide(longPt);
  // Nothing to gain on a page that is already drawn at about that size.
  if (side <= Math.max(page.originalWidth, page.originalHeight) * 1.1) return page;
  try {
    let doc = opened.get(page.source.fileId);
    if (!doc) {
      // pdf.js takes ownership of the buffer it is given, so it gets a copy.
      doc = await openPdfData(bytes.slice());
      opened.set(page.source.fileId, doc);
    }
    const pdfPage = await doc.doc.getPage(page.source.pageIndex + 1);
    let hi;
    try {
      hi = await renderPdfPage(pdfPage, side, RENDER_JPEG_QUALITY, 0, 16);
    } finally {
      pdfPage.cleanup();
    }
    const f = hi.width / page.originalWidth;
    const scaled = page.quad ? (page.quad.map((p) => ({ x: p.x * f, y: p.y * f })) as ScannerPage["quad"]) : null;
    const { renderPage } = await import("./pageProcessing");
    const result = await renderPage({ ...page, originalDataUrl: hi.dataUrl, originalWidth: hi.width, originalHeight: hi.height, quad: scaled });
    if (result.perspectiveFailed) return page;
    // The page keeps its real physical size: points per pixel from what the old picture covered.
    const ptPerPx = (page.processedWidth * page.ptPerPx) / result.width;
    return { ...page, processedDataUrl: result.dataUrl, processedWidth: result.width, processedHeight: result.height, ptPerPx };
  } catch {
    return page;
  }
}

// Every page that needs new pixels, drawn sharply; all other pages are returned as they are.
export async function sharpenFlattenedPages(pages: ScannerPage[]): Promise<ScannerPage[]> {
  if (!pages.some((p) => p.source && !canPreserveSource(p))) return pages;
  const opened = new Map<string, OpenedPdf>();
  try {
    const out: ScannerPage[] = [];
    for (const page of pages) out.push(await sharpenFlattenedPage(page, opened));
    return out;
  } finally {
    for (const doc of opened.values()) await doc.destroy().catch(() => undefined);
  }
}
