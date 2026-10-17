"use client";

import { buildPageLayers, flattenPageToJpeg } from "./annotationRender";
import { exportPageLayout } from "./pageLayout";
import { createPdfPreservingSource } from "./pdfExport";
import { sharpenFlattenedPages } from "./sourceRender";
import { dataUrlBytes, debugLog, isScannerDebug } from "./debugLog";
import type { ScannerPage } from "./page";

// jsPDF is dynamically imported so it never lands in the initial bundle --
// only users who actually create a PDF pay for it. Uses each page's already
// -processed render (crop/rotation/enhancement already baked in by
// pageProcessing.ts), so PDF creation itself does no image processing.
//
// Pages that have annotations (text, pen, highlights, stamps, signatures) are
// flattened first: the annotations are drawn onto the processed image so the
// PDF shows them. Pages without annotations use their image untouched, exactly
// as before.
export async function createPdfFromPages(inputPages: ScannerPage[]): Promise<Blob> {
  if (inputPages.length === 0) throw new Error("no_pages");
  // Pages of an imported PDF that were cropped skewed, enhanced or adjusted are drawn again from the original at
  // about 300 dpi (sourceRender.ts) so the picture that has to be used is sharp.
  const pages = await sharpenFlattenedPages(inputPages);

  // Pages that came from a PDF keep their original content (text, vectors, fonts); see pdfExport.ts.
  // If that path cannot be used for any reason the picture-based writer below produces the PDF.
  try {
    const preserved = await createPdfPreservingSource(pages);
    if (preserved) return preserved;
  } catch (error) {
    console.warn("pdf-export: keeping the original pages failed, exporting page pictures instead", error instanceof Error ? error.name : "");
  }

  const { jsPDF } = await import("jspdf");
  // Each page gets a sheet of its own size and orientation (see pageLayout.ts): a PDF page keeps
  // its original size, a landscape picture gets a landscape sheet, nothing is forced to A4 portrait.
  const first = exportPageLayout(pages[0].processedWidth, pages[0].processedHeight, pages[0].ptPerPx);
  const doc = new jsPDF({ unit: "pt", format: [first.sheetW, first.sheetH], orientation: first.orientation, compress: true });

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const layout = exportPageLayout(page.processedWidth, page.processedHeight, page.ptPerPx);
    if (index > 0) doc.addPage([layout.sheetW, layout.sheetH], layout.orientation);
    const { x, y, w, h } = layout;
    // Pages with inserted pictures are exported as layers, so each picture keeps its own
    // resolution instead of being painted into the page-sized raster (see buildPageLayers).
    const layers = await buildPageLayers(page);
    if (layers) {
      for (const layer of layers) {
        doc.addImage(layer.dataUrl, layer.format, x + layer.x * w, y + layer.y * h, layer.w * w, layer.h * h, undefined, layer.format === "PNG" ? "FAST" : "NONE");
      }
      continue;
    }
    const imageData = page.annotations.length > 0 ? await flattenPageToJpeg(page) : page.processedDataUrl;
    doc.addImage(imageData, "JPEG", x, y, w, h);
  }

  const blob = doc.output("blob");
  if (isScannerDebug()) void logPdfContents(blob, pages);
  return blob;
}

// Debug only: reads the image sizes actually embedded in the finished PDF and
// puts them next to the processed scans they came from.
async function logPdfContents(blob: Blob, pages: ScannerPage[]): Promise<void> {
  const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
  const embedded = [...text.matchAll(/\/Width (\d+)\s*\/Height (\d+)/g)].map((m) => `${m[1]}x${m[2]}`);
  debugLog("pdf", {
    pdfBytes: blob.size,
    pages: pages.length,
    processedScans: pages.map((p) => `${p.processedWidth}x${p.processedHeight} (${dataUrlBytes(p.processedDataUrl)} bytes)`),
    embeddedImages: embedded,
    note: "annotated pages are flattened at their processed size and may differ in bytes",
  });
}
