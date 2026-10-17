// Geometry for inserting pictures (passport photos, logos, stamps...) onto a
// page. Pure maths with no DOM, so it can be tested on its own; the pixel work
// (decoding, rotating, cropping) lives in imageInsert.ts.
//
// A page is exported on an A4 sheet (see pdf.ts): the page image is scaled to
// fit and centred. Real-world sizes in millimetres therefore map exactly onto
// the normalized coordinates annotations use, once the page's shape is known.

import type { Annotation, ImageAnnotation } from "./annotations.ts";

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const MM_PER_PT = 25.4 / 72;

// Picture sizes people ask for. Passport and ID photo sizes differ by country
// and by application, so none of these is presented as "the" size: each is
// just a clearly-labelled width x height in a stated unit.
export interface SizePreset {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

export const PHOTO_PRESETS: readonly SizePreset[] = [
  { id: "35x45mm", label: "35 × 45 mm", widthMm: 35, heightMm: 45 },
  { id: "2x2in", label: "2 × 2 in (51 × 51 mm)", widthMm: 50.8, heightMm: 50.8 },
  { id: "33x48mm", label: "33 × 48 mm", widthMm: 33, heightMm: 48 },
  { id: "25x35mm", label: "25 × 35 mm (small)", widthMm: 25, heightMm: 35 },
];

export function getPreset(id: string | null | undefined): SizePreset | undefined {
  return PHOTO_PRESETS.find((p) => p.id === id);
}

// The printed size of the whole page in millimetres, as the exported PDF draws it.
export function pageSizeMm(pageWidthPx: number, pageHeightPx: number): { w: number; h: number } {
  const scale = Math.min(A4_WIDTH_PT / pageWidthPx, A4_HEIGHT_PT / pageHeightPx);
  return { w: pageWidthPx * scale * MM_PER_PT, h: pageHeightPx * scale * MM_PER_PT };
}

// Normalized width and height that make a picture exactly `widthMm` x `heightMm`
// when the PDF is printed at 100%. Null when it can't fit on the page (the page
// is a small photo, say), so the caller can say so instead of clipping.
export function presetFractions(
  preset: SizePreset,
  pageWidthPx: number,
  pageHeightPx: number,
): { w: number; h: number } | null {
  const page = pageSizeMm(pageWidthPx, pageHeightPx);
  const w = preset.widthMm / page.w;
  const h = preset.heightMm / page.h;
  return w <= 1 && h <= 1 ? { w, h } : null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The largest rectangle with the given pixel aspect (width / height) that fits
// in an image, scaled by `scale` (1 = as large as possible) and centred on
// (cx, cy), kept inside the image. All values are fractions of the image.
export function aspectCropRect(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  scale = 1,
  cx = 0.5,
  cy = 0.5,
): Rect {
  const imageAspect = imageWidth / imageHeight;
  let w: number;
  let h: number;
  if (imageAspect > aspect) {
    h = 1;
    w = aspect / imageAspect;
  } else {
    w = 1;
    h = imageAspect / aspect;
  }
  const s = Math.min(1, Math.max(0.1, scale));
  w *= s;
  h *= s;
  return {
    x: Math.min(1 - w, Math.max(0, cx - w / 2)),
    y: Math.min(1 - h, Math.max(0, cy - h / 2)),
    w,
    h,
  };
}

// Moves a rectangle by (dx, dy) without letting it leave the image.
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return {
    ...rect,
    x: Math.min(1 - rect.w, Math.max(0, rect.x + dx)),
    y: Math.min(1 - rect.h, Math.max(0, rect.y + dy)),
  };
}

// A rectangle dragged out between two points, clamped to the image.
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x1 = clamp(Math.min(ax, bx));
  const y1 = clamp(Math.min(ay, by));
  const x2 = clamp(Math.max(ax, bx));
  const y2 = clamp(Math.max(ay, by));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Where a picture sits after being turned a quarter turn about its own centre:
// its width and height swap (in page pixels), and it is pulled back inside the
// page if the turn would push it over an edge.
export function rotatedBox(box: Rect, pageWidthPx: number, pageHeightPx: number): Rect {
  const wPx = box.h * pageHeightPx;
  const hPx = box.w * pageWidthPx;
  let w = wPx / pageWidthPx;
  let h = hPx / pageHeightPx;
  // Keep it on the page, shrinking proportionally if it is simply too big.
  const shrink = Math.min(1, 1 / w, 1 / h);
  w *= shrink;
  h *= shrink;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return {
    x: Math.min(1 - w, Math.max(0, cx - w / 2)),
    y: Math.min(1 - h, Math.max(0, cy - h / 2)),
    w,
    h,
  };
}

export type StackMove = "forward" | "backward" | "front" | "back";

// Annotations are drawn in list order, so list order is stacking order: later
// is on top. Returns the same array when the mark can't move any further.
export function moveInStack<T extends Annotation>(list: T[], id: string, move: StackMove): T[] {
  const from = list.findIndex((a) => a.id === id);
  if (from < 0) return list;
  const to =
    move === "forward" ? from + 1 : move === "backward" ? from - 1 : move === "front" ? list.length - 1 : 0;
  const target = Math.min(list.length - 1, Math.max(0, to));
  if (target === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

// Whether the picture can still be moved up or down the stack.
export function stackPosition(list: Annotation[], id: string): { canForward: boolean; canBackward: boolean } {
  const i = list.findIndex((a) => a.id === id);
  return { canForward: i >= 0 && i < list.length - 1, canBackward: i > 0 };
}

export function isImageAnnotation(a: Annotation | null | undefined): a is ImageAnnotation {
  return !!a && a.type === "image";
}

// ---- file checks (pure, so they can be tested without a browser) ---------------

export type InsertImageKind = "jpeg" | "png" | "webp";

export const MAX_INSERT_IMAGE_BYTES = 20 * 1024 * 1024;
// Pictures are scaled to this on their longest side: sharp at any size the page
// can show them, and small enough that several fit in memory on a phone.
export const MAX_INSERT_IMAGE_SIDE_PX = 2400;
// Refuses decoding anything bigger than this many pixels (a decompression-bomb guard).
export const MAX_INSERT_IMAGE_PIXELS = 100_000_000;

// What a file really is, from its first bytes -- not from its name or the type
// the browser guessed. Null when it is not a JPEG, PNG or WebP.
export function sniffImageKind(bytes: Uint8Array): InsertImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

// A plain-language reason for a file that can't be inserted. Looks at the real
// content so a HEIC photo renamed to .jpg is still explained properly.
export function describeUnsupportedImage(bytes: Uint8Array, name: string): string {
  const lower = name.toLowerCase();
  const ftyp = bytes.length >= 12 ? ascii(bytes, 4, 12) : "";
  if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(ftyp) || /\.(heic|heif)$/.test(lower)) {
    return "HEIC/HEIF photos (the default on some iPhones) can't be read in the browser. Change your camera's format to Most Compatible, or share the photo as a JPG, then try again.";
  }
  if (ascii(bytes, 0, 3) === "GIF" || /\.gif$/.test(lower)) {
    return "GIF files aren't supported. Save the picture as a JPG, PNG or WebP and try again.";
  }
  if (/\.svg$/.test(lower) || ascii(bytes, 0, 5).toLowerCase() === "<?xml" || ascii(bytes, 0, 4).toLowerCase() === "<svg") {
    return "SVG files aren't supported. Export the picture as a PNG and try again.";
  }
  if (ascii(bytes, 0, 2) === "BM" || /\.bmp$/.test(lower)) {
    return "BMP files aren't supported. Save the picture as a JPG or PNG and try again.";
  }
  if (ascii(bytes, 0, 4) === "%PDF" || /\.pdf$/.test(lower)) {
    return "That is a PDF, not a picture. Upload it as the document on the Scan page, and add pictures here.";
  }
  if (/\.(docx?|xlsx?|pptx?|csv|txt)$/.test(lower)) {
    return "That is a document, not a picture. Open it on the Scan page, and add pictures from here.";
  }
  return "That file isn't a picture we can use. Choose a JPG, PNG or WebP image.";
}
