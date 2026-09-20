// DOCX -> PDF engine entry point. Reads the document's real formatting (fonts,
// sizes, spacing, indents, tables, pictures, headers/footers, sections ...),
// lays it out with Word's rules and draws it as a vector PDF. Runs entirely in
// the browser (or Node, for tests): nothing is uploaded.

import { DocxPackage } from "./package.ts";
import { parseDocx, type Block, type DocModel } from "./model.ts";
import { FontStore, type FamilyKey, type FontLoader } from "./fonts.ts";
import { paginate } from "./paginate.ts";
import { renderPages, type RenderOptions } from "./render.ts";
import type { LayoutEnv } from "./layout.ts";

export type { FontLoader } from "./fonts.ts";

export interface DocxToPdfOptions extends RenderOptions {
  loadFont: FontLoader;
  onStage?: (stage: "reading" | "layout" | "building") => void;
}

export interface DocxToPdfResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
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
  const model = await parseDocx(pkg);
  if (!documentHasContent(model)) throw new EmptyDocumentError();

  options.onStage?.("layout");
  const fonts = new FontStore(options.loadFont);
  // Load every font face the document uses up front, so layout stays synchronous.
  const wanted = new Set(model.faces);
  wanted.add("carlito:r");
  await Promise.all(
    [...wanted].map((key) => {
      const [family, style] = key.split(":");
      return fonts.load(family as FamilyKey, style.startsWith("b"), style.endsWith("i"));
    }),
  );
  if (fonts.all().length === 0) throw new Error("fonts unavailable");

  const env: LayoutEnv = { fonts, defaultTab: model.defaultTab, compatMode: model.compatMode, pageNumber: "1", pageCount: "1", missing: { count: 0 } };
  const pages = paginate(model, env);

  options.onStage?.("building");
  const warnings = [...model.warnings];
  const rendered = await renderPages(pages, fonts, options);
  warnings.push(...rendered.warnings);
  if (env.missing.count > 0) {
    warnings.push("Some characters (for example emoji or unsupported scripts) can't be shown and were replaced with a question mark.");
  }
  return { bytes: rendered.bytes, pageCount: pages.length, warnings };
}
