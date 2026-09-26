// Real font files for the DOCX engine: fonts embedded in the document, fonts the
// person supplies, and fonts installed on their device.
//
// The bundled metric twins (Carlito, Arimo, ...) only cover Calibri, Arial, Times
// New Roman, Courier New and Cambria. Any other font (Aptos, Verdana, Segoe UI
// ...) has no open twin and can't be redistributed with the site, so the only
// way to lay a document out with its real widths is to use the real font file
// when one is available. This registry holds those files, keyed by the family
// name Word uses in the document (Aptos, Aptos Display, Aptos SemiBold ...).

import fontkit from "@pdf-lib/fontkit";
import type { DocxPackage } from "./package.ts";
import { attr, childrenNamed } from "./xml.ts";

export type FontBytes = Uint8Array;

// A file handed in by the caller. `family` overrides the name read from the
// font itself (for files whose internal name is unhelpful).
export type FontFileInput = FontBytes | { bytes: FontBytes; family?: string };

// "Aptos  SemiBold" and "aptos semibold" are the same font to Word.
export function normalizeFontName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Family key the layout and PDF writer use for a registry font. The "@" keeps it
// apart from the bundled family keys.
export const CUSTOM_PREFIX = "@";
export const customFamily = (fontName: string): string => CUSTOM_PREFIX + normalizeFontName(fontName);
export const isCustomFamily = (family: string): boolean => family.startsWith(CUSTOM_PREFIX);

interface FontFileInfo {
  family: string; // normalised legacy family name (name ID 1), as Word writes it
  bold: boolean;
  italic: boolean;
  // False when the font's licence bits forbid embedding it in a PDF.
  embeddable: boolean;
}

type FkFont = {
  familyName?: string;
  subfamilyName?: string;
  numGlyphs?: number;
  hasGlyphForCodePoint?: (cp: number) => boolean;
  head?: { macStyle?: { bold?: boolean; italic?: boolean } };
  "OS/2"?: { fsType?: { noEmbedding?: boolean; bitmapOnly?: boolean } };
  fonts?: unknown[];
};

export function readFontFile(bytes: FontBytes): FontFileInfo | null {
  let font: FkFont;
  try {
    font = fontkit.create(bytes as never) as unknown as FkFont;
  } catch {
    return null;
  }
  // A collection (.ttc) holds several faces in one file; pdf-lib can embed only
  // single-face files.
  if (Array.isArray(font.fonts) || !font.familyName || !font.hasGlyphForCodePoint?.(0x41)) return null;
  const sub = (font.subfamilyName ?? "").toLowerCase();
  const mac = font.head?.macStyle;
  const fsType = font["OS/2"]?.fsType;
  return {
    family: normalizeFontName(font.familyName),
    bold: /\bbold\b/.test(sub) || (sub === "" && !!mac?.bold),
    italic: /\b(italic|oblique)\b/.test(sub) || (sub === "" && !!mac?.italic),
    embeddable: !(fsType?.noEmbedding || fsType?.bitmapOnly),
  };
}

const style = (bold: boolean, italic: boolean): string => `${bold ? "b" : "r"}${italic ? "i" : ""}`;

export class FontRegistry {
  private families = new Map<string, Map<string, FontBytes>>();
  private refused = new Set<string>();

  // Adds one font file. Returns false when it isn't a usable single font or its
  // licence forbids embedding it.
  add(input: FontFileInput, hint?: { family?: string; bold?: boolean; italic?: boolean }): boolean {
    const bytes = input instanceof Uint8Array ? input : input.bytes;
    const family = hint?.family ?? (input instanceof Uint8Array ? undefined : input.family);
    const info = readFontFile(bytes);
    if (!info) return false;
    const name = normalizeFontName(family ?? info.family);
    if (!info.embeddable) {
      this.refused.add(name);
      return false;
    }
    let faces = this.families.get(name);
    if (!faces) {
      faces = new Map();
      this.families.set(name, faces);
    }
    const key = style(hint?.bold ?? info.bold, hint?.italic ?? info.italic);
    if (!faces.has(key)) faces.set(key, bytes);
    return true;
  }

  has(fontName: string): boolean {
    return this.families.has(normalizeFontName(fontName));
  }

  // Family names whose files were found but can't be embedded.
  refusedFamilies(): string[] {
    return [...this.refused].filter((n) => !this.families.has(n));
  }

  // Exact style only: the caller decides what to do when a style is missing.
  get(fontName: string, bold: boolean, italic: boolean): FontBytes | null {
    return this.families.get(normalizeFontName(fontName))?.get(style(bold, italic)) ?? null;
  }

  // The exact style if the family has it, else its regular, else whatever it has.
  nearest(fontName: string, bold: boolean, italic: boolean): FontBytes | null {
    const faces = this.families.get(normalizeFontName(fontName));
    if (!faces) return null;
    return faces.get(style(bold, italic)) ?? faces.get("r") ?? faces.values().next().value ?? null;
  }
}

// ---- fonts embedded in the .docx ------------------------------------------------------

export interface EmbeddedFont {
  name: string;
  bold: boolean;
  italic: boolean;
  bytes: FontBytes;
}

// Word obfuscates embedded fonts (.odttf): the first 32 bytes are XORed with the
// font's GUID key, taken as 16 bytes in reverse order (ECMA-376 Part 2, 17.8.1).
function deobfuscate(data: FontBytes, guid: string): FontBytes | null {
  const hex = guid.replace(/[{}-]/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex) || data.length < 32) return null;
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const out = new Uint8Array(data);
  for (let i = 0; i < 32; i++) out[i] ^= key[15 - (i % 16)];
  return out;
}

// True for the sfnt signatures of TrueType/OpenType fonts, which a correct key
// restores; anything else means a wrong key or a damaged part.
function looksLikeSfnt(b: FontBytes): boolean {
  if (b.length < 4) return false;
  if (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) return true;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  return tag === "OTTO" || tag === "true";
}

const SLOTS: [string, boolean, boolean][] = [
  ["embedRegular", false, false],
  ["embedBold", true, false],
  ["embedItalic", false, true],
  ["embedBoldItalic", true, true],
];

export async function readEmbeddedFonts(pkg: DocxPackage): Promise<EmbeddedFont[]> {
  const table = await pkg.xml("word/fontTable.xml");
  if (!table?.documentElement) return [];
  const rels = await pkg.relationships("word/fontTable.xml");
  const out: EmbeddedFont[] = [];
  for (const font of childrenNamed(table.documentElement, "font")) {
    const name = attr(font, "name");
    if (!name) continue;
    for (const [tag, bold, italic] of SLOTS) {
      for (const el of childrenNamed(font, tag)) {
        const rel = rels.get(attr(el, "id") ?? "");
        const key = attr(el, "fontKey");
        if (!rel || rel.external || !key) continue;
        const raw = await pkg.bytes(rel.target);
        const bytes = raw ? deobfuscate(raw, key) : null;
        if (bytes && looksLikeSfnt(bytes)) out.push({ name, bold, italic, bytes });
      }
    }
  }
  return out;
}

// ---- which fonts a document asks for --------------------------------------------------

// Fonts that are symbol/dingbat sets or otherwise never worth looking for.
const SKIP_LOOKUP = /^(symbol|wingdings.*|webdings|marlett|zapf dingbats|\+.*|.*\bmt extra\b.*)$/i;

// The font names a document mentions, read straight from its XML (run fonts,
// style fonts, theme fonts) before it is parsed, so real font files can be found
// first and the parse knows which fonts are really available.
export async function collectFontNames(pkg: DocxPackage): Promise<string[]> {
  const names = new Set<string>();
  const parts = pkg.list("word/").filter((p) => /^word\/(document|styles|numbering|header\d*|footer\d*|footnotes|endnotes|theme\/theme\d*)\.xml$/.test(p));
  for (const part of parts) {
    const text = await pkg.text(part);
    if (!text) continue;
    for (const m of text.matchAll(/\bw:(?:ascii|hAnsi|cs|eastAsia)="([^"]{1,80})"/g)) names.add(m[1]);
    for (const m of text.matchAll(/<a:latin\b[^>]*\btypeface="([^"]{1,80})"/g)) names.add(m[1]);
  }
  return [...names].map((n) => n.trim()).filter((n) => n && !SKIP_LOOKUP.test(n));
}
