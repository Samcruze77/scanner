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

export interface OoxmlOptions {
  target: number | null;
  // Index into COMPRESSION_LEVELS. With a target, the search starts at the lowest
  // level and only goes as far as it must, so this is ignored.
  level: number;
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
      // A JPEG stays a JPEG; a PNG stays a PNG (lossless, transparency kept).
      const encoded = await reencode(decoded, pic.bytes.length, level, pic.format);
      if (encoded) {
        replacements.set(pic.name, encoded.data);
        changed += 1;
      }
    } finally {
      decoded.dispose();
    }
  }
  return { replacements, changed };
}

// Reads the package (refusing anything that isn't a real Word/Excel file) and
// estimates the size each level would give, from real re-encodes of its largest
// pictures.
export async function analyzeOoxml(
  data: Uint8Array,
  kind: Kind,
  deps: CompressDeps,
  signal?: AbortLike,
  onEstimate?: (sizes: number[]) => void,
): Promise<Analysis> {
  const zip = await open(data, kind);
  const pictures = (await listPictures(zip, kind)).filter((p) => p.bytes.length >= MIN_PICTURE_BYTES);
  const pictureBytes = pictures.reduce((sum, p) => sum + p.bytes.length, 0);
  // Pictures untouched, package repacked: what every level starts from.
  const baseline = (await rebuild(zip, new Map())).length;
  const estimates = await estimateFromPictures({
    baseline,
    pictures: pictures.map((p) => ({ bytes: p.bytes, mime: p.format === "png" ? ("image/png" as const) : ("image/jpeg" as const) })),
    deps,
    signal,
    onEstimate,
  });
  return { estimates, pictureCount: pictures.length, pictureBytes };
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

  // Lossless first: same pictures, better packing.
  let best: { bytes: Uint8Array; changed: number; level: number | null } = { bytes: await rebuild(zip, new Map()), changed: 0, level: null };
  const targetReached = (size: number) => options.target !== null && size <= options.target;

  if (pictures.length > 0 && !targetReached(best.bytes.length)) {
    const start = options.target === null ? options.level : 0;
    const end = options.target === null ? options.level : COMPRESSION_LEVELS.length - 1;
    for (let level = start; level <= end; level++) {
      const { replacements, changed } = await shrinkPictures(pictures, COMPRESSION_LEVELS[level].embedded, deps);
      if (changed === 0) continue;
      deps.onProgress?.("Writing the compressed file…");
      const bytes = await rebuild(zip, replacements);
      if (bytes.length < best.bytes.length) best = { bytes, changed, level };
      if (targetReached(bytes.length)) break;
    }
  }

  // The attempt's size is reported as it is; if it isn't really smaller, the
  // original comes back untouched.
  const compressed = best.bytes.length;
  const delivered = deliver(
    { data: input.data, name: input.name, mime: parts.mime },
    { data: best.bytes, name: `${baseName(input.name, parts.ext)}-compressed.${parts.ext}`, mime: parts.mime },
  );
  const meaningful = delivered.outcome === "reduced";

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
    strongAvailable: false,
    outcome: delivered.outcome,
    // A size-target search reports the level it landed on; lossless repacking alone is no level.
    levelIndex: pictures.length === 0 ? null : options.target === null ? options.level : best.level,
    mode: options.target === null ? "level" : "target",
  };
}
