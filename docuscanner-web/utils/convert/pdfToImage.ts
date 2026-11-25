"use client";

// PDF -> JPG / PNG, entirely in the browser: each chosen page is drawn by PDF.js onto a canvas at
// the chosen resolution, encoded as JPG or PNG, and kept as a Blob until the person downloads it
// (one image, or a ZIP of all of them). Nothing is uploaded. The choices that don't need a
// browser (page ranges, sizes, limits, resolution metadata) are in pdfToImageCore.ts.
//
// Pages are rendered one at a time and each canvas is released straight away, so memory is the
// finished images plus one page being drawn. Pages keep their own size and orientation (a
// landscape page gives a landscape image) and their own /Rotate.

import { openPdf, PdfError } from "@/utils/pdf/pdfjs";
import {
  IMAGE_FORMATS,
  imageFileName,
  JPEG_QUALITY,
  MAX_PDF_TO_IMAGE_PAGES,
  MAX_TOTAL_PIXELS,
  pageRenderSize,
  setImageDpi,
  type ImageFormat,
} from "./pdfToImageCore";

export interface PdfInfo {
  pageCount: number;
  // Each page's size in points after its own rotation.
  pages: { widthPt: number; heightPt: number }[];
}

export type PdfToImageErrorCode = "too_much_output" | "encode_failed" | "canvas_failed";

export class PdfToImageError extends Error {
  readonly code: PdfToImageErrorCode;
  constructor(code: PdfToImageErrorCode) {
    super(code);
    this.name = "PdfToImageError";
    this.code = code;
  }
}

export interface PdfImage {
  pageNumber: number;
  fileName: string;
  blob: Blob;
  width: number;
  height: number;
  // The resolution the image really has (lower than asked for when a huge page had to be scaled down).
  dpi: number;
}

export interface PdfToImageProgress {
  done: number;
  total: number;
}

// Opens the PDF just long enough to read its page count and page sizes. Throws PdfError for
// password-protected, damaged, too-large or too-long files, so the person hears about it as soon
// as they choose the file.
export async function readPdfInfo(file: File): Promise<PdfInfo> {
  const { doc, destroy } = await openPdf(file, { maxPages: MAX_PDF_TO_IMAGE_PAGES });
  try {
    const pages: PdfInfo["pages"] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ widthPt: viewport.width, heightPt: viewport.height });
      page.cleanup();
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await destroy();
  }
}

// Total pixels the chosen pages will produce at `dpi` (for the memory limit and the estimate shown).
export function totalPixels(info: PdfInfo, pages: number[], dpi: number): number {
  return pages.reduce((sum, n) => {
    const { width, height } = pageRenderSize(info.pages[n - 1].widthPt, info.pages[n - 1].heightPt, dpi);
    return sum + width * height;
  }, 0);
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PdfToImageError("encode_failed"))), mime, quality);
  });
}

export async function convertPdfToImages(
  file: File,
  options: {
    format: ImageFormat;
    dpi: number;
    pages: number[];
    baseName: string;
    signal?: AbortSignal;
    onProgress?: (progress: PdfToImageProgress) => void;
  },
): Promise<PdfImage[]> {
  const { format, dpi, pages, baseName, signal, onProgress } = options;
  const { mime } = IMAGE_FORMATS[format];
  const { doc, destroy } = await openPdf(file, { maxPages: MAX_PDF_TO_IMAGE_PAGES });
  const images: PdfImage[] = [];
  try {
    if (pages.some((n) => n < 1 || n > doc.numPages)) throw new PdfError("pdf_failed");

    // Refuse up front rather than run out of memory part-way through.
    let pixels = 0;
    for (const n of pages) {
      const page = await doc.getPage(n);
      const v = page.getViewport({ scale: 1 });
      const size = pageRenderSize(v.width, v.height, dpi);
      pixels += size.width * size.height;
      page.cleanup();
    }
    if (pixels > MAX_TOTAL_PIXELS) throw new PdfToImageError("too_much_output");

    onProgress?.({ done: 0, total: pages.length });
    for (const n of pages) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const page = await doc.getPage(n);
      const canvas = document.createElement("canvas");
      try {
        const base = page.getViewport({ scale: 1 });
        const size = pageRenderSize(base.width, base.height, dpi);
        const viewport = page.getViewport({ scale: size.scale });
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new PdfToImageError("canvas_failed");
        // PDF pages are paper: give them a white background (JPEG has no transparency, and a PNG
        // with see-through gaps between the text would look broken in most viewers).
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;

        const encoded = await canvasToBlob(canvas, mime, format === "jpg" ? JPEG_QUALITY : undefined);
        const bytes = setImageDpi(new Uint8Array(await encoded.arrayBuffer()), format, size.effectiveDpi);
        images.push({
          pageNumber: n,
          fileName: imageFileName(baseName, n, doc.numPages, format),
          blob: new Blob([bytes as BlobPart], { type: mime }),
          width: size.width,
          height: size.height,
          dpi: size.effectiveDpi,
        });
      } finally {
        page.cleanup();
        // Free the canvas memory right away (matters on iPhone/iPad).
        canvas.width = canvas.height = 0;
      }
      onProgress?.({ done: images.length, total: pages.length });
    }
    return images;
  } finally {
    await destroy();
  }
}

// One ZIP of all the images. They are already compressed, so they are stored as they are.
export async function zipImages(images: PdfImage[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const image of images) zip.file(image.fileName, image.blob, { compression: "STORE" });
  return zip.generateAsync({ type: "blob", compression: "STORE", mimeType: "application/zip" });
}
