// PDF compression, in two strengths.
//
// Standard: keeps the PDF exactly as it is -- text stays text (selectable,
// searchable, sharp), vectors stay vectors -- and only re-encodes the JPEG
// pictures inside it at a lower quality/size, then writes the file with
// compact object streams. This is where scanned documents and photo-heavy PDFs
// get most of their weight.
//
// Stronger: for files Standard can't shrink enough (or when a small target
// can't otherwise be met), redraws every page as a picture at a reduced
// resolution. That gets small files, but the text stops being selectable, so it
// is only ever done when the person asks for it.

import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";
import {
  BALANCED_LEVEL,
  CompressError,
  IMAGE_LEVELS,
  isMeaningfulReduction,
  reductionPercent,
  type CompressDeps,
  type CompressReport,
  type Level,
} from "./types.ts";

export interface PdfOptions {
  target: number | null;
  strong: boolean;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "document";
}

function nameOf(value: unknown): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

function filterOf(dict: PDFDict): string | null {
  const filter = dict.get(PDFName.of("Filter"));
  if (filter instanceof PDFName) return nameOf(filter);
  if (filter instanceof PDFArray && filter.size() === 1) return nameOf(filter.get(0));
  return null;
}

interface JpegImage {
  ref: PDFRef;
  stream: PDFRawStream;
}

// JPEG pictures we can safely re-encode: plain DCT streams, 8 bits per channel,
// not stencil masks, not CMYK/other colour spaces with special decoding.
function findJpegImages(pdf: PDFDocument): JpegImage[] {
  const found: JpegImage[] = [];
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    if (nameOf(dict.get(PDFName.of("Subtype"))) !== "Image") continue;
    if (filterOf(dict) !== "DCTDecode") continue;
    const stencil = dict.get(PDFName.of("ImageMask"));
    if (stencil instanceof PDFBool && stencil.asBoolean()) continue;
    if (dict.get(PDFName.of("Decode"))) continue;
    const bits = dict.get(PDFName.of("BitsPerComponent"));
    if (bits instanceof PDFNumber && bits.asNumber() !== 8) continue;
    const space = dict.get(PDFName.of("ColorSpace"));
    const spaceName = nameOf(space);
    // DeviceRGB/DeviceGray only: CMYK JPEGs and indexed/ICC spaces are left alone.
    if (spaceName !== "DeviceRGB" && spaceName !== "DeviceGray") continue;
    found.push({ ref, stream: object });
  }
  return found;
}

// Re-encodes the JPEGs of one document at a level. Returns how many changed.
async function recompressImages(pdf: PDFDocument, images: JpegImage[], level: Level, deps: CompressDeps): Promise<number> {
  let changed = 0;
  let done = 0;
  for (const image of images) {
    done += 1;
    deps.onProgress?.(`Compressing pictures (${done} of ${images.length})…`);
    const bytes = image.stream.getContents();
    const decoded = await deps.codec.decode(bytes, "image/jpeg");
    if (!decoded) continue;
    try {
      const longSide = Math.max(decoded.width, decoded.height);
      const encoded = await decoded.encode({ maxDim: longSide > level.maxDim ? level.maxDim : null, quality: level.quality, format: "jpeg" });
      // Only replace a picture when it really got smaller.
      if (!encoded || encoded.data.length >= bytes.length * 0.95) continue;
      const dict = image.stream.dict.clone(pdf.context);
      dict.set(PDFName.of("Width"), PDFNumber.of(encoded.width));
      dict.set(PDFName.of("Height"), PDFNumber.of(encoded.height));
      dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
      dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
      dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
      dict.delete(PDFName.of("DecodeParms"));
      pdf.context.assign(image.ref, PDFRawStream.of(dict, encoded.data));
      changed += 1;
    } finally {
      decoded.dispose();
    }
  }
  return changed;
}

async function loadPdf(data: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false });
  } catch (error) {
    const name = error instanceof Error ? error.constructor.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "EncryptedPDFError" || /encrypt/i.test(message)) throw new CompressError("compress_password");
    throw new CompressError("compress_invalid");
  }
}

async function saveCompact(pdf: PDFDocument): Promise<Uint8Array> {
  return pdf.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 5000 });
}

// ---- standard ------------------------------------------------------------------

async function compressStandard(data: Uint8Array, options: PdfOptions, deps: CompressDeps): Promise<{ bytes: Uint8Array; imageCount: number; changed: number; levelUsed: number }> {
  const probe = await loadPdf(data);
  const imageCount = findJpegImages(probe).length;

  // With no pictures to shrink, the only thing left is a compact rewrite.
  if (imageCount === 0) {
    deps.onProgress?.("Optimizing the file…");
    return { bytes: await saveCompact(probe), imageCount: 0, changed: 0, levelUsed: -1 };
  }

  const start = options.target === null ? BALANCED_LEVEL : 0;
  const end = options.target === null ? BALANCED_LEVEL : IMAGE_LEVELS.length - 1;
  let best: { bytes: Uint8Array; changed: number; levelUsed: number } | null = null;
  for (let level = start; level <= end; level++) {
    const pdf = level === start ? probe : await loadPdf(data);
    const images = findJpegImages(pdf);
    const changed = await recompressImages(pdf, images, IMAGE_LEVELS[level], deps);
    deps.onProgress?.("Writing the compressed file…");
    const bytes = await saveCompact(pdf);
    if (!best || bytes.length < best.bytes.length) best = { bytes, changed, levelUsed: level };
    if (options.target !== null && bytes.length <= options.target) break;
  }
  return { bytes: (best as NonNullable<typeof best>).bytes, imageCount, changed: (best as NonNullable<typeof best>).changed, levelUsed: (best as NonNullable<typeof best>).levelUsed };
}

// ---- stronger ------------------------------------------------------------------

// Page rendering scales (1 = 72 dpi) with the JPEG quality used at each step.
const STRONG_LEVELS = [
  { scale: 2.0, quality: 0.72 },
  { scale: 1.67, quality: 0.64 },
  { scale: 1.4, quality: 0.56 },
  { scale: 1.15, quality: 0.5 },
  { scale: 1.0, quality: 0.45 },
];

async function compressStrong(data: Uint8Array, options: PdfOptions, deps: CompressDeps): Promise<{ bytes: Uint8Array; levelUsed: number }> {
  if (!deps.openRenderer) throw new CompressError("compress_failed");
  let renderer;
  try {
    renderer = await deps.openRenderer(data);
  } catch {
    throw new CompressError("compress_invalid");
  }
  try {
    let best: { bytes: Uint8Array; levelUsed: number } | null = null;
    const start = options.target === null ? 1 : 0;
    for (let li = start; li < STRONG_LEVELS.length; li++) {
      const { scale, quality } = STRONG_LEVELS[li];
      const out = await PDFDocument.create();
      for (let i = 0; i < renderer.pageCount; i++) {
        deps.onProgress?.(`Redrawing pages (${i + 1} of ${renderer.pageCount})…`);
        const page = await renderer.render(i, scale, quality);
        const jpg = await out.embedJpg(page.data);
        const p = out.addPage([page.widthPt, page.heightPt]);
        p.drawImage(jpg, { x: 0, y: 0, width: page.widthPt, height: page.heightPt });
      }
      const bytes = await saveCompact(out);
      if (!best || bytes.length < best.bytes.length) best = { bytes, levelUsed: li };
      if (options.target === null || bytes.length <= options.target) break;
    }
    return best as NonNullable<typeof best>;
  } finally {
    await renderer.dispose();
  }
}

// ---- entry ---------------------------------------------------------------------

export async function compressPdf(
  input: { data: Uint8Array; name: string },
  options: PdfOptions,
  deps: CompressDeps,
): Promise<CompressReport> {
  const original = input.data.length;
  const notes: string[] = [];
  let bytes: Uint8Array;
  let strongAvailable = false;

  if (options.strong) {
    const result = await compressStrong(input.data, options, deps);
    bytes = result.bytes;
    notes.push("Pages were redrawn as pictures, so the text in this PDF can no longer be selected or searched.");
  } else {
    const result = await compressStandard(input.data, options, deps);
    bytes = result.bytes;
    if (result.imageCount === 0) {
      notes.push("This PDF has no JPEG pictures to shrink; it was only rewritten more compactly. Text and vector graphics are untouched.");
    } else {
      notes.push(`Recompressed ${result.changed} of ${result.imageCount} picture${result.imageCount === 1 ? "" : "s"}. Text and vector graphics are untouched, so text stays sharp and selectable.`);
      if (result.changed < result.imageCount) notes.push("Pictures that would not get smaller were left as they are.");
    }
    strongAvailable = deps.openRenderer !== undefined;
  }

  const compressed = bytes.length;
  const meaningful = isMeaningfulReduction(original, compressed);
  let targetMet: boolean | null = null;
  if (options.target !== null) {
    targetMet = compressed <= options.target;
    if (!targetMet) {
      notes.push(
        options.strong
          ? "The target couldn't be reached without unacceptable quality loss."
          : "Standard compression couldn't reach the target while keeping text sharp.",
      );
    }
  }
  if (!meaningful) notes.push("This PDF is already about as small as it can safely be.");

  return {
    data: bytes,
    mime: "application/pdf",
    filename: `${baseName(input.name)}-compressed.pdf`,
    originalBytes: original,
    compressedBytes: compressed,
    reductionPct: reductionPercent(original, compressed),
    meaningful,
    targetMet,
    targetBytes: options.target,
    notes,
    // Offer the stronger option when the standard result is weak or missed the target.
    strongAvailable: strongAvailable && (!meaningful || targetMet === false),
  };
}
