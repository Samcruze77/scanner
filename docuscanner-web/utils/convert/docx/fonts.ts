// Font selection and text measurement for the DOCX engine.
//
// Word documents name fonts the browser can't embed (Calibri, Arial, Times New
// Roman ...). We substitute open, metric-compatible fonts -- the same widths and
// line heights, so lines wrap and pages break where Word's do:
//   Calibri -> Carlito, Cambria -> Caladea, Arial -> Arimo (Liberation Sans),
//   Times New Roman -> Tinos (Liberation Serif), Courier New -> Cousine.
// Fonts with no metric twin (Aptos, Verdana, Georgia ...) can't be bundled: they
// are used from a real font file when one is available (embedded in the
// document, supplied by the person, or installed on their device -- see
// fontFiles.ts) and otherwise map to the closest family, so their line breaks
// can differ from Word's.

import fontkit from "@pdf-lib/fontkit";
import { CUSTOM_PREFIX, type FontRegistry } from "./fontFiles.ts";

export type BundledFamily = "carlito" | "caladea" | "arimo" | "tinos" | "cousine";
// A bundled family, or "@<font name>" for a font from the registry.
export type FamilyKey = BundledFamily | (string & {});

// Which scripts each family ships (see scripts/copy-font-assets.mjs). Tried in
// this order when looking for a glyph.
export const FAMILY_SUBSETS: Record<BundledFamily, string[]> = {
  carlito: ["latin", "latin-ext", "cyrillic", "greek"],
  caladea: ["latin", "latin-ext"],
  arimo: ["latin", "latin-ext", "cyrillic", "greek"],
  tinos: ["latin", "latin-ext", "cyrillic", "greek"],
  cousine: ["latin", "latin-ext", "cyrillic", "greek"],
};

export type FontLoader = (family: BundledFamily, subset: string, bold: boolean, italic: boolean) => Promise<Uint8Array | null>;

const FAMILY_PATTERNS: [RegExp, BundledFamily][] = [
  [/^(times new roman|times|liberation serif|tinos|garamond|palatino.*|book antiqua|bookman.*|century schoolbook|century|baskerville.*|didot|minion.*|serif)$/i, "tinos"],
  [/^(cambria|cambria math|caladea|constantia|georgia|gelasio|rockwell|sitka.*)$/i, "caladea"],
  [/^(arial|arial narrow|arial black|arial unicode ms|helvetica.*|verdana|tahoma|liberation sans|arimo|microsoft sans serif|franklin gothic.*|century gothic|lucida sans.*|lucida grande|impact|sans-serif|nimbus sans.*)$/i, "arimo"],
  [/^(courier new|courier|consolas|lucida console|monaco|menlo|liberation mono|cousine|monospace|andale mono|courier.*)$/i, "cousine"],
  [/^(calibri|calibri light|carlito|candara|corbel|segoe ui.*|aptos.*|trebuchet ms|gill sans.*|myriad.*|lato|open sans.*|source sans.*|roboto.*)$/i, "carlito"],
];

// `familyHint` is the `w:family` value from fontTable.xml, used for fonts we
// don't recognise by name.
export function pickFamily(fontName: string | undefined, familyHint?: string): BundledFamily {
  const name = (fontName ?? "").trim();
  for (const [pattern, family] of FAMILY_PATTERNS) if (pattern.test(name)) return family;
  if (familyHint === "roman") return "tinos";
  if (familyHint === "modern") return "cousine";
  return "carlito";
}

export function isMetricCompatible(fontName: string | undefined): boolean {
  return /^(calibri|calibri light|cambria|arial|times new roman|courier new|liberation .*|carlito|caladea|arimo|tinos|cousine)$/i.test((fontName ?? "").trim());
}

// Twins whose widths match the Microsoft font but whose vertical metrics don't.
// Caladea is drawn with Cambria's own line metrics (hhea 1946/-455/0 of 2048):
// against Word its ascent of 0.90 put every Cambria line ~1pt too high and
// shortened each line by 0.02 of the font size, which adds up over a page.
const VERTICAL_METRICS: Record<string, { ascent: number; descent: number; lineGap: number }> = {
  caladea: { ascent: 1946 / 2048, descent: 455 / 2048, lineGap: 0 },
};

interface Subset {
  bytes: Uint8Array;
  // fontkit font, used only to read metrics and glyph advances.
  fk: {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    lineGap: number;
    hasGlyphForCodePoint: (cp: number) => boolean;
    glyphForCodePoint: (cp: number) => { advanceWidth: number };
  };
}

export class Face {
  readonly family: FamilyKey;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly subsets: Subset[];
  private advances = new Map<number, number>();
  private owners = new Map<number, number>();

  constructor(family: FamilyKey, bold: boolean, italic: boolean, subsets: Subset[]) {
    this.family = family;
    this.bold = bold;
    this.italic = italic;
    this.subsets = subsets;
  }

  get key(): string {
    return faceKey(this.family, this.bold, this.italic);
  }

  // Line metrics as fractions of the font size.
  get ascent(): number {
    const fk = this.subsets[0].fk;
    return VERTICAL_METRICS[this.family]?.ascent ?? fk.ascent / fk.unitsPerEm;
  }
  get descent(): number {
    const fk = this.subsets[0].fk;
    return VERTICAL_METRICS[this.family]?.descent ?? Math.abs(fk.descent) / fk.unitsPerEm;
  }
  get lineGap(): number {
    const fk = this.subsets[0].fk;
    return VERTICAL_METRICS[this.family]?.lineGap ?? fk.lineGap / fk.unitsPerEm;
  }

  // Index of the subset holding this character, or -1.
  subsetOf(cp: number): number {
    const cached = this.owners.get(cp);
    if (cached !== undefined) return cached;
    let owner = -1;
    for (let i = 0; i < this.subsets.length; i++) {
      if (this.subsets[i].fk.hasGlyphForCodePoint(cp)) {
        owner = i;
        break;
      }
    }
    this.owners.set(cp, owner);
    return owner;
  }

  // Advance width in em (1 = the font size).
  advance(cp: number): number {
    const cached = this.advances.get(cp);
    if (cached !== undefined) return cached;
    const owner = this.subsetOf(cp);
    let value = 0;
    if (owner >= 0) {
      const fk = this.subsets[owner].fk;
      value = fk.glyphForCodePoint(cp).advanceWidth / fk.unitsPerEm;
    }
    this.advances.set(cp, value);
    return value;
  }
}

export function faceKey(family: FamilyKey, bold: boolean, italic: boolean): string {
  return `${family}:${bold ? "b" : "r"}${italic ? "i" : ""}`;
}

export class FontStore {
  private faces = new Map<string, Face>();
  private pending = new Map<string, Promise<Face | null>>();
  private loader: FontLoader;
  private registry: FontRegistry | undefined;

  constructor(loader: FontLoader, registry?: FontRegistry) {
    this.loader = loader;
    this.registry = registry;
  }

  // Loads a face (all its script subsets) once. Missing subsets are skipped; a
  // face with no Latin subset at all can't be used.
  async load(family: FamilyKey, bold: boolean, italic: boolean): Promise<Face | null> {
    const key = faceKey(family, bold, italic);
    const existing = this.faces.get(key);
    if (existing) return existing;
    let inFlight = this.pending.get(key);
    if (!inFlight) {
      inFlight = (async () => {
        const subsets: Subset[] = [];
        // A registry font is one file; the Carlito face of the same style is
        // appended so characters the font lacks (symbols, other scripts) are
        // still drawn instead of turning into question marks.
        if (family.startsWith(CUSTOM_PREFIX)) {
          const bytes = this.registry?.nearest(family.slice(CUSTOM_PREFIX.length), bold, italic);
          if (!bytes) return null;
          try {
            subsets.push({ bytes, fk: fontkit.create(bytes as never) as unknown as Subset["fk"] });
          } catch {
            return null;
          }
          const fallback = await this.load("carlito", bold, italic);
          if (fallback) subsets.push(...fallback.subsets);
          const face = new Face(family, bold, italic, subsets);
          this.faces.set(key, face);
          return face;
        }
        for (const name of FAMILY_SUBSETS[family as BundledFamily]) {
          const bytes = await this.loader(family as BundledFamily, name, bold, italic).catch(() => null);
          if (!bytes) continue;
          try {
            const fk = fontkit.create(bytes as never) as unknown as Subset["fk"];
            subsets.push({ bytes, fk });
          } catch {
            // A subset that can't be parsed is left out.
          }
        }
        if (subsets.length === 0) return null;
        const face = new Face(family, bold, italic, subsets);
        this.faces.set(key, face);
        return face;
      })();
      this.pending.set(key, inFlight);
    }
    return inFlight;
  }

  // Sync lookup after `load`. Falls back to the same family's regular face so a
  // face that failed to load never stops layout.
  get(family: FamilyKey, bold: boolean, italic: boolean): Face {
    const exact = this.faces.get(faceKey(family, bold, italic));
    if (exact) return exact;
    const regular = this.faces.get(faceKey(family, false, false));
    if (regular) return regular;
    const any = this.faces.values().next().value;
    if (any) return any;
    throw new Error("No fonts loaded");
  }

  all(): Face[] {
    return [...this.faces.values()];
  }
}
