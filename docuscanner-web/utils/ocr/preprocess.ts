"use client";

// Builds the image the OCR engine reads from a scanner page. Starts from the
// page's already-rendered result (so the user's crop, perspective correction,
// rotation and chosen enhancement are all honoured) and works on a throwaway
// canvas -- the page itself, its thumbnail and the PDF are never touched.

import type { ScannerPage } from "@/utils/scanner/page";
import { OcrError, type OcrDocumentResult } from "./types";

// Upscaling beyond this only adds memory and blur.
const MAX_UPSCALE = 2;

// Identifies exactly what was read. If it changes later (crop, rotate,
// enhancement, re-render) the extracted text no longer matches the page.
export function ocrSourceKey(page: ScannerPage): string {
  return [
    page.processedWidth,
    page.processedHeight,
    page.processedDataUrl.length,
    page.enhancement,
    page.rotation,
    page.cropEnabled ? 1 : 0,
    page.brightness,
    page.contrast,
  ].join(":");
}

// True when any page in the result was removed, moved, or re-rendered since
// it was read.
export function isOcrResultStale(result: OcrDocumentResult, pages: ScannerPage[]): boolean {
  return result.pages.some((read) => {
    const index = pages.findIndex((p) => p.id === read.pageId);
    return index === -1 || index + 1 !== read.pageNumber || ocrSourceKey(pages[index]) !== read.sourceKey;
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new OcrError("unsupported_image"));
    img.src = dataUrl;
  });
}

export async function prepareOcrImage(page: ScannerPage, targetLongSidePx: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(page.processedDataUrl);
  const { naturalWidth, naturalHeight } = img;
  if (naturalWidth === 0 || naturalHeight === 0) throw new OcrError("unsupported_image");

  // Scanned pages are capped around 2000px upstream (~170 DPI for A4), which
  // is on the low side for small print. Scale toward a size that reads well
  // without blowing up canvas memory on phones.
  const scale = Math.min(MAX_UPSCALE, targetLongSidePx / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // A null context here almost always means the browser refused the
  // allocation.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new OcrError("out_of_memory");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  // Photos left on "Original" benefit from grayscale + contrast stretch
  // before recognition. Pages the user already enhanced are used as-is.
  if (page.enhancement === "original") {
    const { applyEnhancement } = await import("@/utils/scanner/enhance");
    const imageData = ctx.getImageData(0, 0, width, height);
    applyEnhancement(imageData, "auto");
    ctx.putImageData(imageData, 0, 0);
  }

  return canvas;
}

export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
