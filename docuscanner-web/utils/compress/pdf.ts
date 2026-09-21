// PDF compression, in two strengths.
//
// Standard: keeps the PDF exactly as it is -- text stays text (selectable,
// searchable, sharp), vectors stay vectors -- and only re-encodes the JPEG
// pictures inside it at the chosen level, drops hidden extras that don't affect
// how a page looks (page thumbnails, XMP metadata, application-private data),
// then writes the file with compact object streams. This is where scanned
// documents and photo-heavy PDFs get most of their weight.
//
// Stronger: for files Standard can't shrink enough (or when a small target
// can't otherwise be met), redraws every page as a picture at a reduced
// resolution. That gets small files, but the text stops being selectable, so it
// is only ever done when the person asks for it.

import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";
import { estimateFromPictures, reencode, type AbortLike } from "./estimate.ts";
import {
  CompressError,
  COMPRESSION_LEVELS,
  deliver,
  reductionPercent,
  type Analysis,
  type CompressDeps,
  type CompressReport,
  type Level,
} from "./types.ts";

export interface PdfOptions {
  target: number | null;
  strong: boolean;
  // Index into COMPRESSION_LEVELS. With a target, the search starts at the lowest
  // level and only goes as far as it must, so this is ignored.
  level: number;
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
      // Only replace a picture when it really got smaller.
      const encoded = await reencode(decoded, bytes.length, level, "jpeg");
      if (!encoded) continue;
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

// Password-protected files are refused here, with a clear reason, rather than
// producing a broken or unreadable result.
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

// Removes things that never change how a page looks: page thumbnails, the XMP
// metadata packet and application-private data. Document properties (title,
// author) are left alone. Returns how many were removed.
function stripHiddenData(pdf: PDFDocument): number {
  let removed = 0;
  const drop = (dict: PDFDict, key: PDFName) => {
    const value = dict.get(key);
    if (value === undefined) return;
    if (value instanceof PDFRef) pdf.context.delete(value);
    dict.delete(key);
    removed += 1;
  };
  drop(pdf.catalog, PDFName.of("Metadata"));
  drop(pdf.catalog, PDFName.of("PieceInfo"));
  for (const page of pdf.getPages()) {
    drop(page.node, PDFName.of("Thumb"));
    drop(page.node, PDFName.of("PieceInfo"));
  }
  return removed;
}

async function loadPrepared(data: Uint8Array): Promise<{ pdf: PDFDocument; hidden: number }> {
  const pdf = await loadPdf(data);
  return { pdf, hidden: stripHiddenData(pdf) };
}

async function saveCompact(pdf: PDFDocument): Promise<Uint8Array> {
  return pdf.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 5000 });
}

// ---- standard ------------------------------------------------------------------

interface StandardResult {
  bytes: Uint8Array;
  imageCount: number;
  changed: number;
  // Level that produced `bytes`, or -1 when no picture was involved.
  levelUsed: number;
  hidden: number;
}

async function compressStandard(data: Uint8Array, options: PdfOptions, deps: CompressDeps): Promise<StandardResult> {
  const { pdf: probe, hidden } = await loadPrepared(data);
  const imageCount = findJpegImages(probe).length;

  // With no pictures to shrink, the only thing left is a compact rewrite.
  if (imageCount === 0) {
    deps.onProgress?.("Optimizing the file…");
    return { bytes: await saveCompact(probe), imageCount: 0, changed: 0, levelUsed: -1, hidden };
  }

  const start = options.target === null ? options.level : 0;
  const end = options.target === null ? options.level : COMPRESSION_LEVELS.length - 1;
  let best: { bytes: Uint8Array; changed: number; levelUsed: number } | null = null;
  for (let level = start; level <= end; level++) {
    const pdf = level === start ? probe : (await loadPrepared(data)).pdf;
    const images = findJpegImages(pdf);
    const changed = await recompressImages(pdf, images, COMPRESSION_LEVELS[level].embedded, deps);
    deps.onProgress?.("Writing the compressed file…");
    const bytes = await saveCompact(pdf);
    if (!best || bytes.length < best.bytes.length) best = { bytes, changed, levelUsed: level };
    if (options.target !== null && bytes.length <= options.target) break;
  }
  const chosen = best as NonNullable<typeof best>;
  return { bytes: chosen.bytes, imageCount, changed: chosen.changed, levelUsed: chosen.levelUsed, hidden };
}

// ---- stronger ------------------------------------------------------------------

// Page rendering scales (1 = 72 dpi) with the JPEG quality used at each step,
// index-aligned with COMPRESSION_LEVELS.
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
    const start = options.target === null ? options.level : 0;
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

// ---- estimate ------------------------------------------------------------------

// Reads the file (refusing password-protected or damaged PDFs) and estimates the
// size each level would give, from real re-encodes of its largest pictures.
export async function analyzePdf(
  data: Uint8Array,
  deps: CompressDeps,
  signal?: AbortLike,
  onEstimate?: (sizes: number[]) => void,
): Promise<Analysis> {
  const { pdf } = await loadPrepared(data);
  const images = findJpegImages(pdf);
  const pictures = images.map((image) => ({ bytes: image.stream.getContents(), mime: "image/jpeg" as const }));
  const pictureBytes = pictures.reduce((sum, p) => sum + p.bytes.length, 0);
  // The compact rewrite with pictures untouched is what every level starts from.
  const baseline = (await saveCompact(pdf)).length;
  const estimates = await estimateFromPictures({ baseline, pictures, deps, signal, onEstimate });
  return { estimates, pictureCount: pictures.length, pictureBytes };
}

// ---- entry ---------------------------------------------------------------------

// Below this, redrawing pages as pictures can only make a file bigger.
const STRONG_MIN_BYTES = 200 * 1024;

export async function compressPdf(
  input: { data: Uint8Array; name: string },
  options: PdfOptions,
  deps: CompressDeps,
): Promise<CompressReport> {
  const original = input.data.length;
  const notes: string[] = [];
  let bytes: Uint8Array;
  let strongAvailable = false;
  let levelIndex: number | null = options.level;

  if (options.strong) {
    const result = await compressStrong(input.data, options, deps);
    bytes = result.bytes;
    levelIndex = result.levelUsed;
    notes.push("Pages were redrawn as pictures, so the text in this PDF can no longer be selected or searched.");
  } else {
    const result = await compressStandard(input.data, options, deps);
    bytes = result.bytes;
    // With no pictures in the file no level was applied, so none is reported.
    levelIndex = result.levelUsed >= 0 ? result.levelUsed : null;
    if (result.imageCount === 0) {
      notes.push("This PDF has no JPEG pictures to shrink; it was only rewritten more compactly. Text and vector graphics are untouched.");
    } else {
      notes.push(`Recompressed ${result.changed} of ${result.imageCount} picture${result.imageCount === 1 ? "" : "s"}. Text and vector graphics are untouched, so text stays sharp and selectable.`);
      if (result.changed < result.imageCount) notes.push("Pictures that would not get smaller were left as they are.");
    }
    if (result.hidden > 0) notes.push("Removed hidden extras that don't affect how pages look (thumbnails and embedded metadata).");
    strongAvailable = deps.openRenderer !== undefined;
  }

  const compressed = bytes.length;
  const delivered = deliver(
    { data: input.data, name: input.name, mime: "application/pdf" },
    { data: bytes, name: `${baseName(input.name)}-compressed.pdf`, mime: "application/pdf" },
  );
  const meaningful = delivered.outcome === "reduced";
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

  return {
    data: delivered.data,
    mime: delivered.mime,
    filename: delivered.name,
    originalBytes: original,
    compressedBytes: compressed,
    reductionPct: reductionPercent(original, compressed),
    meaningful,
    targetMet,
    targetBytes: options.target,
    notes,
    // Offer the stronger option when the standard result is weak or missed the target,
    // but not for files so small that redrawing pages could only make them bigger.
    strongAvailable: strongAvailable && original >= STRONG_MIN_BYTES && (!meaningful || targetMet === false),
    outcome: delivered.outcome,
    levelIndex,
    mode: options.strong ? "flatten" : options.target !== null ? "target" : "level",
  };
}
