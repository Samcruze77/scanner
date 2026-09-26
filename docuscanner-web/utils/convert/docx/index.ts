// DOCX -> PDF engine entry point. Reads the document's real formatting (fonts,
// sizes, spacing, indents, tables, pictures, headers/footers, sections ...),
// lays it out with Word's rules and draws it as a vector PDF. Runs entirely in
// the browser (or Node, for tests): nothing is uploaded.

import { DocxPackage } from "./package.ts";
import { parseDocx, type Block, type DocModel } from "./model.ts";
import { FontStore, isMetricCompatible, type FontLoader } from "./fonts.ts";
import { FontRegistry, collectFontNames, isCustomFamily, readEmbeddedFonts, type FontFileInput } from "./fontFiles.ts";
import { paginate } from "./paginate.ts";
import { renderPages, type RenderOptions } from "./render.ts";
import type { LayoutEnv } from "./layout.ts";

export type { FontLoader } from "./fonts.ts";
export type { FontFileInput } from "./fontFiles.ts";

export interface DocxToPdfOptions extends RenderOptions {
  loadFont: FontLoader;
  // Real font files supplied by the caller (for example fonts the person added).
  fontFiles?: FontFileInput[];
  // Looks up real font files for fonts the document uses that were neither
  // embedded in it nor supplied (for example fonts installed on the device).
  findFonts?: (names: string[]) => Promise<FontFileInput[]>;
  onStage?: (stage: "reading" | "layout" | "building") => void;
}

export interface DocxToPdfResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
  // Fonts that had no real font file, so a look-alike was used instead.
  missingFonts: string[];
}

export class EmptyDocumentError extends Error {
  constructor() {
    super("empty document");
    this.name = "EmptyDocumentError";
  }
}

function hasContent(blocks: Block[]): boolean {
  return blocks.some((b) =>
    b.kind === "p"
      ? b.inlines.some((i) => (i.t === "text" && i.text.trim() !== "") || i.t === "image")
      : b.rows.some((r) => r.cells.some((c) => hasContent(c.blocks))),
  );
}

function documentHasContent(model: DocModel): boolean {
  return model.sections.some((s) => hasContent(s.blocks));
}

export async function docxToPdf(data: ArrayBuffer | Uint8Array, options: DocxToPdfOptions): Promise<DocxToPdfResult> {
  options.onStage?.("reading");
  const pkg = await DocxPackage.open(data);

  // Real font files first, so the parse knows which fonts are truly available:
  // fonts embedded in the document, then ones the caller supplied, then whatever
  // the caller can find for the fonts still missing.
  const registry = new FontRegistry();
  const fontWarnings: string[] = [];
  for (const f of await readEmbeddedFonts(pkg)) registry.add(f.bytes, { family: f.name, bold: f.bold, italic: f.italic });
  for (const f of options.fontFiles ?? []) registry.add(f);
  if (options.findFonts) {
    const missing = (await collectFontNames(pkg)).filter((n) => !isMetricCompatible(n) && !registry.has(n));
    if (missing.length > 0) {
      const found = await options.findFonts([...new Set(missing)]).catch(() => []);
      for (const f of found) registry.add(f);
    }
  }
  for (const name of registry.refusedFamilies()) {
    fontWarnings.push(`The font "${name}" doesn't allow embedding in a PDF, so it wasn't used.`);
  }

  const model = await parseDocx(pkg, registry);
  if (!documentHasContent(model)) throw new EmptyDocumentError();

  options.onStage?.("layout");
  const fonts = new FontStore(options.loadFont, registry);
  // Load every font face the document uses up front, so layout stays synchronous.
  const wanted = new Set(model.faces);
  wanted.add("carlito:r");
  for (const key of [...wanted]) if (isCustomFamily(key)) wanted.add(`${key.slice(0, key.lastIndexOf(":"))}:r`);
  const loaded = await Promise.all(
    [...wanted].map(async (key) => {
      const cut = key.lastIndexOf(":");
      const family = key.slice(0, cut);
      const style = key.slice(cut + 1);
      const bold = style.startsWith("b");
      const italic = style.endsWith("i");
      const face = await fonts.load(family, bold, italic);
      return { family, bold, italic, face };
    }),
  );
  if (fonts.all().length === 0) throw new Error("fonts unavailable");
  // A real font family without its bold/italic file: that text uses the regular.
  for (const { family, bold, italic, face } of loaded) {
    if (!face || !isCustomFamily(family) || (!bold && !italic) || !model.faces.has(`${family}:${bold ? "b" : "r"}${italic ? "i" : ""}`)) continue;
    if (!registry.get(family.slice(1), bold, italic)) {
      fontWarnings.push(`"${family.slice(1)}" has no ${bold && italic ? "bold italic" : bold ? "bold" : "italic"} font file, so its regular style was used for that text.`);
    }
  }

  const env: LayoutEnv = { fonts, defaultTab: model.defaultTab, compatMode: model.compatMode, pageNumber: "1", pageCount: "1", missing: { count: 0 } };
  const pages = paginate(model, env);

  options.onStage?.("building");
  const warnings = [...model.warnings, ...fontWarnings];
  const rendered = await renderPages(pages, fonts, options);
  warnings.push(...rendered.warnings);
  if (env.missing.count > 0) {
    warnings.push("Some characters (for example emoji or unsupported scripts) can't be shown and were replaced with a question mark.");
  }
  return { bytes: rendered.bytes, pageCount: pages.length, warnings, missingFonts: model.missingFonts };
}
