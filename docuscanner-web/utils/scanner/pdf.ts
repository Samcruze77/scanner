"use client";

import { flattenPageToJpeg } from "./annotationRender";
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
export async function createPdfFromPages(pages: ScannerPage[]): Promise<Blob> {
  if (pages.length === 0) throw new Error("no_pages");

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    if (index > 0) doc.addPage();
    const imageData = page.annotations.length > 0 ? await flattenPageToJpeg(page) : page.processedDataUrl;
    const scale = Math.min(pageWidth / page.processedWidth, pageHeight / page.processedHeight);
    const w = page.processedWidth * scale;
    const h = page.processedHeight * scale;
    const x = (pageWidth - w) / 2;
    const y = (pageHeight - h) / 2;
    doc.addImage(imageData, "JPEG", x, y, w, h);
  }

  return doc.output("blob");
}
