"use client";

import type { ScannerPage } from "./page";

// jsPDF is dynamically imported so it never lands in the initial bundle --
// only users who actually create a PDF pay for it. Uses each page's already
// -processed render (crop/rotation/enhancement already baked in by
// pageProcessing.ts), so PDF creation itself does no image processing.
export async function createPdfFromPages(pages: ScannerPage[]): Promise<Blob> {
  if (pages.length === 0) throw new Error("no_pages");

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  pages.forEach((page, index) => {
    if (index > 0) doc.addPage();
    const scale = Math.min(pageWidth / page.processedWidth, pageHeight / page.processedHeight);
    const w = page.processedWidth * scale;
    const h = page.processedHeight * scale;
    const x = (pageWidth - w) / 2;
    const y = (pageHeight - h) / 2;
    doc.addImage(page.processedDataUrl, "JPEG", x, y, w, h);
  });

  return doc.output("blob");
}
