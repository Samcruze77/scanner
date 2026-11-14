"use client";

// PDF export that keeps the original PDF's content.
//
// Opening a PDF in the scanner workspace shows each page as a picture so it can be marked up. Rebuilding
// the PDF from those pictures would turn selectable text, fonts and vector drawing into pixels. Instead,
// a page that came from a PDF and has not had its PIXELS changed is re-embedded from the original PDF, and the
// person's additions (text, pen, highlights, check marks, signatures, pictures) are drawn on top as real PDF
// content: text as text, pen and marks as vector paths, highlights as multiply-blended rectangles, pictures at
// their own resolution. Rotating a page and cropping it to a RECTANGLE do not change pixels either: the crop is
// applied as a clip box on the original page, so the text and vector drawing stay.
//
// What is kept: the page's text and its fonts, vector graphics, embedded images at full quality, the page size
// and orientation, and the page order. What is not: links, form fields and bookmarks of the source page (the
// page becomes a flat page with its content).
//
// What genuinely needs new pixels: grayscale, black and white, auto levels, brightness and contrast (they
// change the colour of the artwork itself, which PDF cannot do reliably for text, vectors and embedded
// photographs together), a skewed (perspective) crop, and a crop the person asked to remove for good. Those
// pages are exported as a picture of the page, drawn again from the ORIGINAL PDF at about 300 dpi
// (see sourceRender.ts), not enlarged from the on-screen picture. A rectangle crop hides the cropped-away
// area but the PDF still contains it; "remove for good" is the option that does not.
// Photographs and scans are not PDFs, so they are always pictures. What the person adds to them is still
// written as real PDF content on top of the UNTOUCHED page picture: painting it into the picture would encode
// the whole page again (softer every time) and would lock the typed text and the signature to the picture's
// own resolution, which is low for a photo received through a messaging app (about 120 dpi on A4).

import { BlendMode, LineCapStyle, PDFDocument, StandardFonts, degrees, popGraphicsState, pushGraphicsState, rgb, translate, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { Annotation, TextAnnotation } from "./annotations";
import { ensureAnnotationImages, layoutText, renderAnnotations } from "./annotationRender";
import { exportPageLayout } from "./pageLayout";
import type { ScannerPage } from "./page";
import { getSourcePdf } from "./sourcePdfs";
import { axisAlignedRect, cropToUserSpace, flattenReason } from "./cropMath";

export function canPreserveSource(page: ScannerPage): boolean {
  return !!page.source && !!getSourcePdf(page.source.fileId) && flattenReason(page) === null;
}

// The opened PDFs parsed once per export. A PDF that pdf-lib cannot read (one carrying restrictions or
// encryption, or a damaged one) gives null: its pages cannot be re-embedded and are exported as pictures.
export interface SourceDocs {
  load(fileId: string): Promise<PDFDocument | null>;
}

export function createSourceDocs(): SourceDocs {
  const docs = new Map<string, Promise<PDFDocument | null>>();
  return {
    load(fileId) {
      let doc = docs.get(fileId);
      if (!doc) {
        const bytes = getSourcePdf(fileId);
        doc = bytes ? PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }).catch(() => null) : Promise.resolve(null);
        docs.set(fileId, doc);
      }
      return doc;
    },
  };
}

// The opened PDFs among these pages that cannot be re-embedded although nothing the person did prevents it.
export async function unreadableSources(pages: ScannerPage[], docs: SourceDocs): Promise<Set<string>> {
  const out = new Set<string>();
  for (const page of pages) {
    if (page.source && canPreserveSource(page) && !(await docs.load(page.source.fileId))) out.add(page.source.fileId);
  }
  return out;
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
    // About 300 dpi for the sheet (at least twice the page picture), within what a canvas can hold.
    const long = Math.max(pw, ph);
    const scale = Math.max(1, Math.min(RASTER_TEXT_MAX_SIDE_PX / long, Math.max(2, ((Math.max(sheetW, sheetH) / 72) * 300) / long)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(pw * scale);
    canvas.height = Math.round(ph * scale);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(canvas.width / pw, canvas.height / ph);
      await ensureAnnotationImages(needsRaster);
      renderAnnotations(ctx, pw, ph, needsRaster);
      const image = await embedDataUrl(out, canvas.toDataURL("image/png"));
      pdfPage.drawImage(image, { x: 0, y: 0, width: sheetW, height: sheetH });
    }
    canvas.width = canvas.height = 0;
  }
}

const RASTER_TEXT_MAX_SIDE_PX = 4096;

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

// Builds the exported PDF with pdf-lib. Returns null when there is nothing for it to keep: no page comes from
// a PDF and nobody added anything (the caller then uses the plain picture writer, which is unchanged).
export async function createPdfPreservingSource(pages: ScannerPage[], docs: SourceDocs = createSourceDocs()): Promise<Blob | null> {
  if (!pages.some((page) => canPreserveSource(page) || page.annotations.length > 0)) return null;

  const out = await PDFDocument.create();
  const fonts = fontsFor(out);
  const loadSource = (fileId: string) => docs.load(fileId);

  for (const page of pages) {
    const src = canPreserveSource(page) && page.source ? await loadSource(page.source.fileId) : null;
    if (src && page.source && page.source.pageIndex < src.getPageCount()) {
      const srcPage = src.getPage(page.source.pageIndex);
      const pageBox = srcPage.getCropBox();
      // A rectangle crop becomes a clip box on the page itself.
      const rect = page.cropEnabled && page.quad ? axisAlignedRect(page.quad) : null;
      const box = rect
        ? (() => {
            const u = cropToUserSpace(pageBox, srcPage.getRotation().angle, rect, page.originalWidth, page.originalHeight);
            return { x: u.left, y: u.bottom, width: u.right - u.left, height: u.top - u.bottom };
          })()
        : pageBox;
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
    // The page picture exactly as it is (its bytes are embedded, not encoded again)...
    const image = await embedDataUrl(out, page.processedDataUrl);
    const left = layout.x;
    const bottom = layout.sheetH - layout.y - layout.h;
    pdfPage.drawImage(image, { x: left, y: bottom, width: layout.w, height: layout.h });
    // ...and the additions on top of it as real PDF content, in the picture's own box on the sheet.
    if (page.annotations.length > 0) {
      pdfPage.pushOperators(pushGraphicsState(), translate(left, bottom));
      await drawAnnotations(out, pdfPage, page, layout.w, layout.h, fonts);
      pdfPage.pushOperators(popGraphicsState());
    }
  }

  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
