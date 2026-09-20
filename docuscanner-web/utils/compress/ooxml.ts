// Compression for Word (.docx) and Excel (.xlsx) files. Both are zip packages, and
// nearly all of their weight is the pictures inside (word/media, xl/media).
//
// What is done, and only this:
//  - pictures are re-encoded in the SAME format under the SAME name (a JPEG stays
//    a JPEG, a PNG stays a PNG, transparency is kept), so every relationship,
//    content type, crop and layout reference in the document stays valid;
//  - the package is rewritten with maximum deflate for the XML parts, and stored
//    as-is for already-compressed pictures.
// The document's own XML (text, formulas, styles, sheets, tables) is never
// edited or re-serialised. If there are no pictures worth shrinking the file is
// reported as already compact rather than pretending to compress it.

import JSZip from "jszip";
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

export interface OoxmlOptions {
  target: number | null;
}

type Kind = "word" | "excel";

const PARTS: Record<Kind, { main: string; media: string; ext: string; mime: string; label: string }> = {
  word: {
    main: "word/document.xml",
    media: "word/media/",
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "document",
  },
  excel: {
    main: "xl/workbook.xml",
    media: "xl/media/",
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "workbook",
  },
};

const IMAGE_EXT: Record<string, "jpeg" | "png"> = { jpg: "jpeg", jpeg: "jpeg", png: "png" };
// Pictures smaller than this aren't worth touching.
const MIN_PICTURE_BYTES = 30 * 1024;

function baseName(name: string, ext: string): string {
  return name.replace(new RegExp(`\\.${ext}$`, "i"), "") || "file";
}

async function open(data: Uint8Array, kind: Kind): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new CompressError("compress_invalid");
  }
  if (!zip.file("[Content_Types].xml") || !zip.file(PARTS[kind].main)) throw new CompressError("compress_invalid");
  return zip;
}

interface Picture {
  name: string;
  bytes: Uint8Array;
  format: "jpeg" | "png";
}

async function listPictures(zip: JSZip, kind: Kind): Promise<Picture[]> {
  const out: Picture[] = [];
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || !name.startsWith(PARTS[kind].media)) continue;
    const format = IMAGE_EXT[name.split(".").pop()?.toLowerCase() ?? ""];
    if (!format) continue;
    const bytes = await (zip.file(name) as JSZip.JSZipObject).async("uint8array");
    out.push({ name, bytes, format });
  }
  return out;
}

async function rebuild(
  original: JSZip,
  replacements: Map<string, Uint8Array>,
): Promise<Uint8Array> {
  // Same entries in the same order ([Content_Types].xml first, as Office writes it).
  const out = new JSZip();
  for (const name of Object.keys(original.files)) {
    const entry = original.files[name];
    if (entry.dir) {
      out.folder(name.replace(/\/$/, ""));
      continue;
    }
    const isPicture = /\.(jpe?g|png|gif|webp)$/i.test(name);
    const data = replacements.get(name) ?? (await (original.file(name) as JSZip.JSZipObject).async("uint8array"));
    out.file(name, data, {
      // Pictures are already compressed; everything else gets maximum deflate.
      compression: isPicture ? "STORE" : "DEFLATE",
      compressionOptions: isPicture ? undefined : { level: 9 },
      date: entry.date,
    });
  }
  return out.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

async function shrinkPictures(pictures: Picture[], level: Level, deps: CompressDeps): Promise<{ replacements: Map<string, Uint8Array>; changed: number }> {
  const replacements = new Map<string, Uint8Array>();
  let changed = 0;
  let done = 0;
  for (const pic of pictures) {
    done += 1;
    deps.onProgress?.(`Compressing pictures (${done} of ${pictures.length})…`);
    if (pic.bytes.length < MIN_PICTURE_BYTES) continue;
    const decoded = await deps.codec.decode(pic.bytes, pic.format === "png" ? "image/png" : "image/jpeg");
    if (!decoded) continue;
    try {
      const longSide = Math.max(decoded.width, decoded.height);
      const maxDim = longSide > level.maxDim ? level.maxDim : null;
      // A JPEG stays a JPEG; a PNG stays a PNG (lossless, transparency kept).
      const encoded = await decoded.encode({ maxDim, quality: level.quality, format: pic.format });
      if (encoded && encoded.data.length < pic.bytes.length * 0.95) {
        replacements.set(pic.name, encoded.data);
        changed += 1;
      }
    } finally {
      decoded.dispose();
    }
  }
  return { replacements, changed };
}

export async function compressOoxml(
  input: { data: Uint8Array; name: string },
  kind: Kind,
  options: OoxmlOptions,
  deps: CompressDeps,
): Promise<CompressReport> {
  const parts = PARTS[kind];
  const original = input.data.length;
  const zip = await open(input.data, kind);
  const pictures = await listPictures(zip, kind);
  const notes: string[] = [];

  // Level -1 is lossless: same pictures, better packing.
  let best: { bytes: Uint8Array; changed: number } = { bytes: await rebuild(zip, new Map()), changed: 0 };
  const targetReached = (size: number) => options.target !== null && size <= options.target;

  if (pictures.length > 0 && !targetReached(best.bytes.length)) {
    const start = options.target === null ? BALANCED_LEVEL : 0;
    const end = options.target === null ? BALANCED_LEVEL : IMAGE_LEVELS.length - 1;
    for (let level = start; level <= end; level++) {
      const { replacements, changed } = await shrinkPictures(pictures, IMAGE_LEVELS[level], deps);
      if (changed === 0) continue;
      deps.onProgress?.("Writing the compressed file…");
      const bytes = await rebuild(zip, replacements);
      if (bytes.length < best.bytes.length) best = { bytes, changed };
      if (targetReached(bytes.length)) break;
    }
  }

  // Never hand back something bigger than what came in.
  const bytes = best.bytes.length < original ? best.bytes : input.data;
  const compressed = bytes.length;
  const meaningful = isMeaningfulReduction(original, compressed);

  if (pictures.length === 0) {
    notes.push(`This ${parts.label} contains no pictures, so there is very little to shrink. Its text, formatting and structure were left exactly as they are.`);
  } else if (best.changed > 0) {
    notes.push(`Recompressed ${best.changed} of ${pictures.length} picture${pictures.length === 1 ? "" : "s"} in the same format. Text, formatting, layout${kind === "excel" ? ", formulas and sheets" : " and structure"} were not touched.`);
  } else {
    notes.push("The pictures in this file are already compressed well.");
  }
  let targetMet: boolean | null = null;
  if (options.target !== null) {
    targetMet = compressed <= options.target;
  }
  if (!meaningful) notes.push(`This ${parts.label} is already compact.`);

  return {
    data: bytes,
    mime: parts.mime,
    filename: `${baseName(input.name, parts.ext)}-compressed.${parts.ext}`,
    originalBytes: original,
    compressedBytes: compressed,
    reductionPct: reductionPercent(original, compressed),
    meaningful,
    targetMet,
    targetBytes: options.target,
    notes,
    strongAvailable: false,
  };
}
