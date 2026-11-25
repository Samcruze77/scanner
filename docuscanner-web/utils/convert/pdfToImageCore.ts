// PDF -> JPG / PNG: the decisions that don't need a browser (so they can be unit-tested in Node).
// The rendering itself is in pdfToImage.ts.
//
//  - Which pages: "1-3, 5" style ranges, checked against the PDF's page count.
//  - How big: the chosen resolution (DPI) turns the page's size in points into pixels, but a
//    canvas larger than MAX_CANVAS_PIXELS fails on iPhone/iPad, so a very large page is scaled
//    down to fit (and the image then records the resolution it really has).
//  - How much: all images stay in memory until downloaded, so a run is refused up front when
//    the pages at that resolution would add up to more than MAX_TOTAL_PIXELS.
//  - The resolution is written into the files (JPEG JFIF density, PNG pHYs), so Word, image
//    viewers and print dialogs show a 300 DPI page at its real paper size instead of 3-4x too big.

export type ImageFormat = "jpg" | "png";

export const IMAGE_FORMATS: Record<ImageFormat, { mime: string; ext: string; label: string }> = {
  jpg: { mime: "image/jpeg", ext: "jpg", label: "JPG" },
  png: { mime: "image/png", ext: "png", label: "PNG" },
};

export const RESOLUTIONS = [
  { dpi: 72, label: "Small", note: "72 DPI: for screens and quick previews" },
  { dpi: 150, label: "Standard", note: "150 DPI: sharp on screen, fine for most uses" },
  { dpi: 300, label: "High", note: "300 DPI: for printing and fine detail" },
] as const;
export type Dpi = (typeof RESOLUTIONS)[number]["dpi"];
export const DEFAULT_DPI: Dpi = 150;

export const JPEG_QUALITY = 0.92;
export const MAX_PDF_TO_IMAGE_PAGES = 100;
// iOS Safari refuses canvases above 16,777,216 pixels; stay a little under.
export const MAX_CANVAS_PIXELS = 16_000_000;
// All output images are held in memory until they are downloaded.
export const MAX_TOTAL_PIXELS = 400_000_000;

export type PageRange = { pages: number[] } | { error: string };

// "1-3, 5" -> [1, 2, 3, 5]. Empty input means every page. Accepts spaces, en dashes and
// reversed ranges ("5-3"); refuses anything outside 1..pageCount.
export function parsePageRange(input: string, pageCount: number): PageRange {
  const text = input.trim();
  if (text === "") return { pages: Array.from({ length: pageCount }, (_, i) => i + 1) };
  const pages = new Set<number>();
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim();
    if (part === "") continue;
    const match = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(part);
    if (!match) return { error: `"${part}" isn't a page number or range. Use numbers like 1-3, 5.` };
    const a = Number(match[1]);
    const b = match[2] === undefined ? a : Number(match[2]);
    const [from, to] = a <= b ? [a, b] : [b, a];
    if (from < 1 || to > pageCount) {
      return { error: pageCount === 1 ? "This PDF has only 1 page." : `This PDF has pages 1 to ${pageCount}.` };
    }
    for (let p = from; p <= to; p++) pages.add(p);
  }
  if (pages.size === 0) return { error: "Enter the pages to convert, for example 1-3, 5." };
  return { pages: [...pages].sort((x, y) => x - y) };
}

// Pixel size of a page at `dpi`, scaled down if needed to stay within the canvas limit.
// widthPt / heightPt are the page's size in points (1/72 inch) after its own rotation.
export function pageRenderSize(widthPt: number, heightPt: number, dpi: number) {
  let scale = dpi / 72;
  const area = widthPt * heightPt * scale * scale;
  const capped = area > MAX_CANVAS_PIXELS;
  if (capped) scale = Math.sqrt(MAX_CANVAS_PIXELS / (widthPt * heightPt));
  // Rounded, not floored: A4 at 150 DPI is 1240 x 1754 (flooring would trim most of a pixel row).
  // A capped page is floored instead, so rounding up can never push it over the canvas limit.
  const fit = capped ? Math.floor : Math.round;
  const width = Math.max(1, fit(widthPt * scale));
  const height = Math.max(1, fit(heightPt * scale));
  return { scale, width, height, capped, effectiveDpi: Math.round(scale * 72) };
}

// File name for one page: "report.pdf", page 3 of 12 -> "report-page-03.jpg". A one-page PDF
// keeps the plain name ("report.jpg").
export function imageFileName(baseName: string, pageNumber: number, pageCount: number, format: ImageFormat): string {
  const ext = IMAGE_FORMATS[format].ext;
  if (pageCount === 1) return `${baseName}.${ext}`;
  const digits = String(pageCount).length;
  return `${baseName}-page-${String(pageNumber).padStart(Math.max(2, digits), "0")}.${ext}`;
}

// ---- resolution metadata ------------------------------------------------------------------------

// JPEG: browsers write a JFIF APP0 segment right after the start marker with "no units, 1:1".
// Set it to dots per inch. Returns the input unchanged if the expected segment isn't there.
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const isJfif =
    bytes.length > 20 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] === 0xe0 &&
    bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x00;
  if (!isJfif) return bytes;
  const out = bytes.slice();
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  out[13] = 1; // units: dots per inch
  out[14] = d >> 8;
  out[15] = d & 0xff;
  out[16] = d >> 8;
  out[17] = d & 0xff;
  return out;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// PNG: insert (or replace) a pHYs chunk right after IHDR, in pixels per metre.
// Returns the input unchanged if it isn't a PNG with an IHDR first.
export function setPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes.length < 33 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (type(12) !== "IHDR") return bytes;
  const afterIhdr = 8 + 12 + view.getUint32(8);

  // Drop any existing pHYs so there is exactly one.
  const parts: Uint8Array[] = [bytes.subarray(0, afterIhdr)];
  let at = afterIhdr;
  while (at + 12 <= bytes.length) {
    const len = view.getUint32(at);
    const end = at + 12 + len;
    if (type(at + 4) !== "pHYs") parts.push(bytes.subarray(at, end));
    at = end;
  }

  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const c = new DataView(chunk.buffer);
  c.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  c.setUint32(8, ppm);
  c.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  c.setUint32(17, crc32(chunk.subarray(4, 17)));

  const total = parts.reduce((n, p) => n + p.length, 0) + chunk.length;
  const out = new Uint8Array(total);
  out.set(parts[0], 0);
  out.set(chunk, parts[0].length);
  let pos = parts[0].length + chunk.length;
  for (const p of parts.slice(1)) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function setImageDpi(bytes: Uint8Array, format: ImageFormat, dpi: number): Uint8Array {
  return format === "jpg" ? setJpegDpi(bytes, dpi) : setPngDpi(bytes, dpi);
}
