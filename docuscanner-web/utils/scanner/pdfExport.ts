"use client";

// PDF export that keeps the original PDF's content.
//
// Opening a PDF in the scanner workspace shows each page as a picture so it can be marked up. Rebuilding
// the PDF from those pictures would turn selectable text, fonts and vector drawing into pixels. Instead,
// a page that came from a PDF and has not had its PIXELS changed (no crop, no enhancement, no brightness
// or contrast) is re-embedded from the original PDF, and the person's additions (text, pen, highlights,
// check marks, signatures, pictures) are drawn on top as real PDF content: text as text, pen and marks
// as vector paths, highlights as multiply-blended rectangles, pictures at their own resolution.
//
// What is kept: the page's text and its fonts, vector graphics, embedded images at full quality, the
// page size and orientation, and the page order. What is not: links, form fields and bookmarks of the
// source page (the page becomes a flat page with its content), and any page that was cropped or enhanced,
// which needs new pixels and is exported as a picture of the page (at its true physical size).
// Photographs and scans are not PDFs, so they are always pictures.

import { BlendMode, LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { Annotation, TextAnnotation } from "./annotations";
import { buildPageLayers, ensureAnnotationImages, flattenPageToJpeg, layoutText, renderAnnotations } from "./annotationRender";
import { exportPageLayout } from "./pageLayout";
import type { ScannerPage } from "./page";
import { getSourcePdf } from "./sourcePdfs";

export function canPreserveSource(page: ScannerPage): boolean {
  return (
    !!page.source &&
    !!getSourcePdf(page.source.fileId) &&
    !page.cropEnabled &&
    page.enhancement === "original" &&
    page.brightness === 0 &&
    page.contrast === 0
  );
}

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(",");
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

async function embedDataUrl(out: PDFDocument, dataUrl: string): Promise<PDFImage> {
  const { bytes, mime } = dataUrlBytes(dataUrl);
  return mime === "image/png" ? out.embedPng(bytes) : out.embedJpg(bytes);
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Fonts {
  get(bold: boolean, italic: boolean): Promise<PDFFont>;
}

function fontsFor(out: PDFDocument): Fonts {
  const cache = new Map<string, PDFFont>();
  return {
    async get(bold, italic) {
      const name = bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
      let font = cache.get(name);
      if (!font) {
        font = await out.embedFont(name);
        cache.set(name, font);
      }
      return font;
    },
  };
}

// Draws the person's additions on a PDF page whose size is sheetW x sheetH points. Coordinates in an
// annotation are fractions of the page (origin top-left); PDF's origin is bottom-left.
async function drawAnnotations(out: PDFDocument, pdfPage: PDFPage, page: ScannerPage, sheetW: number, sheetH: number, fonts: Fonts): Promise<void> {
  const pw = page.processedWidth;
  const ph = page.processedHeight;
  const kx = sheetW / pw;
  const ky = sheetH / ph;
  const X = (nx: number) => nx * sheetW;
  const Y = (ny: number) => sheetH - ny * sheetH;
  const needsRaster: Annotation[] = [];

  for (const a of page.annotations) {
    if (a.type === "text") {
      if (!(await drawText(pdfPage, a, pw, ky, kx, sheetH, fonts))) needsRaster.push(a);
    } else if (a.type === "ink") {
      if (a.points.length === 0) continue;
      const color = hexToRgb(a.color);
      const width = a.width * sheetW;
      if (a.points.length === 1) {
        pdfPage.drawCircle({ x: X(a.points[0][0]), y: Y(a.points[0][1]), size: width / 2, color });
        continue;
      }
      // The same smoothing the editor draws: quadratic curves through the midpoints of the samples.
      const p = a.points.map(([nx, ny]) => [nx * sheetW, ny * sheetH] as const);
      let d = `M ${p[0][0]} ${p[0][1]}`;
      for (let i = 1; i < p.length - 1; i++) d += ` Q ${p[i][0]} ${p[i][1]} ${(p[i][0] + p[i + 1][0]) / 2} ${(p[i][1] + p[i + 1][1]) / 2}`;
      d += ` L ${p[p.length - 1][0]} ${p[p.length - 1][1]}`;
      pdfPage.drawSvgPath(d, { x: 0, y: sheetH, borderColor: color, borderWidth: width, borderLineCap: LineCapStyle.Round });
    } else if (a.type === "highlight") {
      pdfPage.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w * sheetW, height: a.h * sheetH, color: hexToRgb(a.color), opacity: 0.7, blendMode: BlendMode.Multiply });
    } else if (a.type === "check" || a.type === "cross") {
      const x = X(a.x), y = a.y * sheetH, w = a.w * sheetW, h = a.h * sheetH;
      const thickness = Math.max(1, Math.min(w, h) * 0.13);
      const color = hexToRgb(a.color);
      const line = (x1: number, y1: number, x2: number, y2: number) =>
        pdfPage.drawLine({ start: { x: x + x1 * w, y: sheetH - (y + y1 * h) }, end: { x: x + x2 * w, y: sheetH - (y + y2 * h) }, thickness, color, lineCap: LineCapStyle.Round });
      if (a.type === "check") {
        line(0.16, 0.54, 0.38, 0.76);
        line(0.38, 0.76, 0.84, 0.24);
      } else {
        line(0.2, 0.2, 0.8, 0.8);
        line(0.8, 0.2, 0.2, 0.8);
      }
    } else if (a.type === "signature" || a.type === "image") {
      // At its own resolution: an unedited JPEG goes in byte for byte, a PNG keeps its alpha.
      const image = await embedDataUrl(out, a.dataUrl);
      pdfPage.drawImage(image, { x: X(a.x), y: Y(a.y + a.h), width: a.w * sheetW, height: a.h * sheetH });
    }
  }

  // Text the standard fonts cannot write (other alphabets, emoji) is drawn as a picture instead, so it
  // still appears; everything else above stays real PDF content.
  if (needsRaster.length > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(pw * 2);
    canvas.height = Math.round(ph * 2);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(2, 2);
      await ensureAnnotationImages(needsRaster);
      renderAnnotations(ctx, pw, ph, needsRaster);
      const image = await embedDataUrl(out, canvas.toDataURL("image/png"));
      pdfPage.drawImage(image, { x: 0, y: 0, width: sheetW, height: sheetH });
    }
    canvas.width = canvas.height = 0;
  }
}

// Returns false when the text cannot be encoded in a standard font (the caller then rasterizes it).
async function drawText(pdfPage: PDFPage, a: TextAnnotation, pageWidthPx: number, ky: number, kx: number, sheetH: number, fonts: Fonts): Promise<boolean> {
  const layout = layoutText(a, pageWidthPx);
  const font = await fonts.get(a.bold, a.italic);
  const fontPt = layout.fontPx * kx;
  try {
    for (const line of layout.lines) if (line) font.widthOfTextAtSize(line, fontPt);
  } catch {
    return false;
  }
  const color = hexToRgb(a.color);
  // Where the editor puts the baseline inside each line box (Arial's ascent and descent).
  const baseline = (layout.lineHeightPx - (0.905 + 0.212) * layout.fontPx) / 2 + 0.905 * layout.fontPx;
  const topPx = a.y * (sheetH / ky);
  layout.lines.forEach((line, i) => {
    if (!line) return;
    pdfPage.drawText(line, { x: a.x * (pageWidthPx * kx), y: sheetH - (topPx + i * layout.lineHeightPx + baseline) * ky, size: fontPt, font, color });
  });
  return true;
}

// Builds the exported PDF with pdf-lib. Returns null when no page can keep its source (the caller then
// uses the picture-based writer, which is unchanged).
export async function createPdfPreservingSource(pages: ScannerPage[]): Promise<Blob | null> {
  if (!pages.some(canPreserveSource)) return null;

  const out = await PDFDocument.create();
  const fonts = fontsFor(out);
  const sources = new Map<string, PDFDocument | null>();
  const loadSource = async (fileId: string): Promise<PDFDocument | null> => {
    if (!sources.has(fileId)) {
      try {
        sources.set(fileId, await PDFDocument.load(getSourcePdf(fileId) as Uint8Array, { ignoreEncryption: false, updateMetadata: false }));
      } catch {
        sources.set(fileId, null);
      }
    }
    return sources.get(fileId) ?? null;
  };

  for (const page of pages) {
    const src = canPreserveSource(page) && page.source ? await loadSource(page.source.fileId) : null;
    if (src && page.source && page.source.pageIndex < src.getPageCount()) {
      const srcPage = src.getPage(page.source.pageIndex);
      const box = srcPage.getCropBox();
      const bw = box.width;
      const bh = box.height;
      // The source page's own /Rotate plus whatever the person turned it by.
      const total = (((srcPage.getRotation().angle + page.rotation) % 360) + 360) % 360;
      const swapped = total === 90 || total === 270;
      const sheetW = swapped ? bh : bw;
      const sheetH = swapped ? bw : bh;
      const embedded = await out.embedPage(srcPage, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height });
      const pdfPage = out.addPage([sheetW, sheetH]);
      const origin = total === 0 ? { x: 0, y: 0 } : total === 90 ? { x: 0, y: bw } : total === 180 ? { x: bw, y: bh } : { x: bh, y: 0 };
      pdfPage.drawPage(embedded, { x: origin.x, y: origin.y, rotate: degrees(-total) });
      await drawAnnotations(out, pdfPage, page, sheetW, sheetH, fonts);
      continue;
    }

    // A picture page: photographs, scans, and PDF pages that were cropped or enhanced.
    const layout = exportPageLayout(page.processedWidth, page.processedHeight, page.ptPerPx);
    const pdfPage = out.addPage([layout.sheetW, layout.sheetH]);
    const layers = await buildPageLayers(page);
    if (layers) {
      for (const layer of layers) {
        const image = await embedDataUrl(out, layer.dataUrl);
        pdfPage.drawImage(image, {
          x: layout.x + layer.x * layout.w,
          y: layout.sheetH - (layout.y + (layer.y + layer.h) * layout.h),
          width: layer.w * layout.w,
          height: layer.h * layout.h,
        });
      }
    } else {
      const dataUrl = page.annotations.length > 0 ? await flattenPageToJpeg(page) : page.processedDataUrl;
      const image = await embedDataUrl(out, dataUrl);
      pdfPage.drawImage(image, { x: layout.x, y: layout.sheetH - layout.y - layout.h, width: layout.w, height: layout.h });
    }
  }

  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
