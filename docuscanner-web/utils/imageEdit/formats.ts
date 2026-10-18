// Image formats for the Edit Image tool: recognising a file by its real bytes, reading its size without
// decoding it (so an enormous picture is refused before it can crash the tab), which download formats the
// browser can genuinely produce, and what each choice costs. Pure functions, tested in Node.

import { LIMITS } from "./ops.ts";

export type InputFormat = "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif";
export type OutputFormat = "jpeg" | "png" | "webp";

export const INPUT_FORMAT_LABEL: Record<InputFormat, string> = { jpeg: "JPEG", png: "PNG", webp: "WebP", gif: "GIF", bmp: "BMP", avif: "AVIF" };

export const FILE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif";

export const OUTPUT_INFO: Record<OutputFormat, { label: string; mime: string; ext: string; alpha: boolean }> = {
  jpeg: { label: "JPEG", mime: "image/jpeg", ext: "jpg", alpha: false },
  png: { label: "PNG", mime: "image/png", ext: "png", alpha: true },
  webp: { label: "WebP", mime: "image/webp", ext: "webp", alpha: true },
};

const ascii = (b: Uint8Array, at: number, text: string): boolean => {
  if (b.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

// What the bytes really are, whatever the file is called. Null when it is none of the supported formats.
export function sniffFormat(b: Uint8Array): InputFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "webp";
  if (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a")) return "gif";
  if (ascii(b, 0, "BM") && b.length >= 26) return "bmp";
  if (ascii(b, 4, "ftyp") && (ascii(b, 8, "avif") || ascii(b, 8, "avis"))) return "avif";
  return null;
}

// The type a produced blob really has, for confirming an encoder did what was asked.
export function sniffOutput(b: Uint8Array): OutputFormat | null {
  const f = sniffFormat(b);
  return f === "jpeg" || f === "png" || f === "webp" ? f : null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// The stored size from the file's header, or null if it cannot be found. The picture is not decoded, and for a
// photo with an EXIF rotation this is the stored (sideways) size: only the pixel count is used for limits.
export function readStoredSize(b: Uint8Array, format: InputFormat): { w: number; h: number } | null {
  try {
    switch (format) {
      case "png":
        return b.length >= 24 && ascii(b, 12, "IHDR") ? { w: u32be(b, 16), h: u32be(b, 20) } : null;
      case "gif":
        return b.length >= 10 ? { w: u16le(b, 6), h: u16le(b, 8) } : null;
      case "bmp": {
        if (b.length < 26) return null;
        const headerSize = u32le(b, 14);
        if (headerSize === 12) return { w: u16le(b, 18), h: u16le(b, 20) };
        return { w: u32le(b, 18) | 0, h: Math.abs(u32le(b, 22) | 0) };
      }
      case "jpeg": {
        let i = 2;
        while (i + 9 < b.length) {
          if (b[i] !== 0xff) {
            i++;
            continue;
          }
          const marker = b[i + 1];
          if (marker === 0xff) {
            i++;
            continue;
          }
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            i += 2;
            continue;
          }
          const length = u16be(b, i + 2);
          const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
          if (isFrame) return { w: u16be(b, i + 7), h: u16be(b, i + 5) };
          i += 2 + length;
        }
        return null;
      }
      case "webp": {
        if (b.length < 30) return null;
        if (ascii(b, 12, "VP8X")) return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
        if (ascii(b, 12, "VP8L")) {
          const bits = u32le(b, 21);
          return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (ascii(b, 12, "VP8 ")) return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
        return null;
      }
      case "avif": {
        // The image spatial extents box ("ispe"): 4 bytes of version/flags, then width and height.
        for (let i = 0; i + 16 < b.length && i < 4096; i++) {
          if (ascii(b, i, "ispe")) return { w: u32be(b, i + 8), h: u32be(b, i + 12) };
        }
        return null;
      }
    }
  } catch {
    return null;
  }
}

export type LoadProblem = "empty" | "unsupported" | "too_big_file" | "too_many_pixels" | "unreadable";

// Checks a chosen file's bytes before any decoding. `bytes` need only be the start of the file (a few
// kilobytes is enough for the headers read here).
export interface InputCheck {
  ok: boolean;
  format: InputFormat | null;
  stored: { w: number; h: number } | null;
  problem: LoadProblem | null;
}

export function checkInput(head: Uint8Array, fileSize: number): InputCheck {
  const bad = (problem: LoadProblem, format: InputFormat | null = null): InputCheck => ({ ok: false, format, stored: null, problem });
  if (fileSize === 0) return bad("empty");
  const format = sniffFormat(head);
  if (!format) return bad("unsupported");
  if (fileSize > LIMITS.maxFileBytes) return bad("too_big_file", format);
  const stored = readStoredSize(head, format);
  if (stored && (stored.w <= 0 || stored.h <= 0)) return bad("unreadable", format);
  if (stored && (stored.w * stored.h > LIMITS.maxInputPixels || Math.max(stored.w, stored.h) > LIMITS.maxSide * 2)) return bad("too_many_pixels", format);
  return { ok: true, format, stored, problem: null };
}

export const LOAD_MESSAGES: Record<LoadProblem, string> = {
  empty: "That file is empty. Choose a different picture.",
  unsupported: "That file isn't a picture this tool can open. Choose a JPEG, PNG, WebP, GIF, BMP or AVIF image.",
  too_big_file: `That file is larger than ${Math.round(LIMITS.maxFileBytes / 1024 / 1024)} MB, which is more than this tool can handle in the browser. Try a smaller picture.`,
  too_many_pixels: `That picture has more than ${LIMITS.maxInputPixels / 1_000_000} million pixels, which is more than this tool can edit safely in the browser. Try a smaller version.`,
  unreadable: "That picture looks damaged and couldn't be opened. Choose a different file.",
};

// ---- download formats -------------------------------------------------------------------------------------

// What the browser was found to be able to encode. Filled in by probing the real encoders
// (utils/imageEdit/browser.ts); kept as plain data so the choices made from it can be tested.
export interface EncoderSupport {
  jpeg: boolean;
  png: boolean;
  webp: boolean;
  // WebP written by this browser at quality 1 reproduces every pixel exactly.
  webpLossless: boolean;
  avif: boolean;
}

export interface FormatChoice {
  format: OutputFormat;
  label: string;
  // "either": lossless only at 100% quality, lossy below (WebP, in a browser that really can write it losslessly).
  kind: "lossless" | "lossy" | "either";
  alpha: boolean;
  // The text of the menu entry, which says exactly what choosing it does.
  optionLabel: string;
  note: string;
}

// Only formats the browser can really produce. AVIF is not offered: no browser tested can encode it from a canvas.
export function availableFormats(support: EncoderSupport): FormatChoice[] {
  const out: FormatChoice[] = [];
  if (support.png) out.push({ format: "png", label: "PNG", kind: "lossless", alpha: true, optionLabel: "PNG (lossless, keeps transparency)", note: "Lossless. Keeps transparency. Larger files." });
  if (support.jpeg) out.push({ format: "jpeg", label: "JPEG", kind: "lossy", alpha: false, optionLabel: "JPEG (lossy, no transparency)", note: "Smaller files. Lossy, and no transparency." });
  if (support.webp)
    out.push({
      format: "webp",
      label: "WebP",
      kind: support.webpLossless ? "either" : "lossy",
      alpha: true,
      optionLabel: support.webpLossless ? "WebP (lossy; lossless at 100% quality; keeps transparency)" : "WebP (lossy, keeps transparency)",
      note: support.webpLossless ? "Small files with transparency. Lossless only when quality is 100%; below that it is lossy." : "Small files with transparency. Lossy in this browser.",
    });
  return out;
}

export function defaultQuality(format: OutputFormat): number {
  return format === "png" ? 1 : 0.95;
}

// The quality number passed to the encoder. PNG ignores it; WebP at 1 is lossless where the browser allows it.
export function encoderQuality(format: OutputFormat, percent: number, webpLossless: boolean): number | undefined {
  if (format === "png") return undefined;
  if (format === "webp" && webpLossless && percent >= 100) return 1;
  return Math.min(1, Math.max(0.05, percent / 100));
}

export interface ExportPlan {
  format: OutputFormat;
  mime: string;
  ext: string;
  // Re-encoding discards some picture information.
  lossy: boolean;
  // The source has transparency that this format cannot keep.
  dropsTransparency: boolean;
  // Nothing is changed and the format is the source's own: the original bytes can be given back untouched.
  canKeepOriginal: boolean;
}

export function planExport(args: {
  source: InputFormat;
  sourceHasAlpha: boolean;
  target: OutputFormat;
  unchanged: boolean;
  webpLossless: boolean;
  qualityPercent: number;
}): ExportPlan {
  const info = OUTPUT_INFO[args.target];
  const lossy = args.target === "jpeg" || (args.target === "webp" && !(args.webpLossless && args.qualityPercent >= 100));
  return {
    format: args.target,
    mime: info.mime,
    ext: info.ext,
    lossy,
    dropsTransparency: args.sourceHasAlpha && !info.alpha,
    canKeepOriginal: args.unchanged && args.source === args.target,
  };
}

// "My photo.final.jpeg" -> "My photo.final-edited.png". Characters that can't be in a filename are replaced,
// but letters from any language are kept.
export function exportFileName(originalName: string, ext: string, edited = true): string {
  const withoutPath = originalName.split(/[\\/]/).pop() ?? "";
  const stem = withoutPath.replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[\u0000-\u001f<>:"|?*]+/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  const base = (safe || "image").slice(0, 120);
  return `${base}${edited ? "-edited" : ""}.${ext}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export function megapixels(w: number, h: number): string {
  return `${((w * h) / 1_000_000).toFixed(1)} MP`;
}

// Whether a WebP file's picture data is lossless (VP8L) or lossy (VP8), read from its chunks. WebP files with
// transparency or extra data start with a VP8X chunk, so the picture chunk is looked for after it.
export function webpEncoding(b: Uint8Array): "lossless" | "lossy" | null {
  if (!(ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP"))) return null;
  let i = 12;
  while (i + 8 <= b.length) {
    const size = u32le(b, i + 4);
    if (ascii(b, i, "VP8L")) return "lossless";
    if (ascii(b, i, "VP8 ")) return "lossy";
    i += 8 + size + (size & 1);
  }
  return null;
}

// Hex colour checks for the JPEG background choice.
export function isHexColour(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}
