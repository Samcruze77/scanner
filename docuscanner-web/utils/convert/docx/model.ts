// Turns a .docx package into a layout-ready document model: every paragraph,
// run, table and cell carries its *effective* formatting (document defaults,
// style chains, numbering, table styles and direct formatting already merged).

import { DocxPackage } from "./package.ts";
import { attr, attrNum, child, childrenNamed, descendants, kids, textOf, toggle } from "./xml.ts";
import { Numbering, type NumberingLevel } from "./numbering.ts";
import {
  StyleSheet,
  mergeCell,
  mergePPr,
  mergeRPr,
  mergeTable,
  parsePPr,
  parseRPr,
  parseTblPr,
  parseTcPr,
} from "./styles.ts";
import { pickFamily, isMetricCompatible, faceKey, type FamilyKey } from "./fonts.ts";
import type { Borders, CellProps, PPr, RPr, TableProps } from "./types.ts";

// ---- model types -------------------------------------------------------------------

export interface RunStyle {
  family: FamilyKey;
  fontName: string;
  size: number; // points
  bold: boolean;
  italic: boolean;
  underline: string | null;
  strike: boolean;
  doubleStrike: boolean;
  color: string; // hex, no '#'
  highlight: string | null;
  shading: string | null;
  caps: boolean;
  smallCaps: boolean;
  vert: "super" | "sub" | null;
  charSpacing: number; // points
  raise: number; // points, positive = up
  hidden: boolean;
  scale: number; // 1 = 100%
}

export interface ImageRef {
  data: Uint8Array;
  mime: string;
  widthPt: number;
  heightPt: number;
  crop: { l: number; t: number; r: number; b: number } | null;
  rotation: number; // degrees
  anchor: AnchorInfo | null;
  description: string;
}

export interface AnchorInfo {
  behind: boolean;
  wrap: "none" | "square" | "topAndBottom" | "tight" | "through";
  hRel: string;
  vRel: string;
  hAlign: string | null;
  vAlign: string | null;
  hOffsetPt: number;
  vOffsetPt: number;
}

export type Inline =
  | { t: "text"; text: string; style: RunStyle; link?: string }
  | { t: "tab"; style: RunStyle }
  | { t: "br"; kind: "line" | "page" | "column"; style: RunStyle }
  | { t: "image"; image: ImageRef; style: RunStyle; link?: string }
  | { t: "field"; kind: "page" | "numpages"; style: RunStyle; cached: string };

export interface ParagraphNumbering {
  label: string;
  level: NumberingLevel;
  style: RunStyle;
}

export interface Paragraph {
  kind: "p";
  ppr: PPr;
  styleId?: string;
  inlines: Inline[];
  markStyle: RunStyle;
  numbering?: ParagraphNumbering;
  sect?: SectionProps;
}

export interface Cell {
  blocks: Block[];
  gridStart: number;
  gridSpan: number;
  vMerge: "restart" | "continue" | null;
  rowSpan: number;
  props: CellProps;
}

export interface Row {
  cells: Cell[];
  height?: { value: number; rule: string };
  isHeader: boolean;
  cantSplit: boolean;
}

export interface Table {
  kind: "t";
  grid: number[];
  rows: Row[];
  props: TableProps;
  // Default cell margins after style resolution (twips).
  cellMargins: { top: number; left: number; bottom: number; right: number };
}

export type Block = Paragraph | Table;

export interface HeaderFooterRefs {
  default?: string;
  first?: string;
  even?: string;
}

export interface SectionProps {
  pageW: number; // twips
  pageH: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: number;
  footer: number;
  gutter: number;
  colCount: number;
  colSpace: number;
  colWidths: number[] | null;
  type: string;
  titlePg: boolean;
  pgNumStart?: number;
  headerRefs: HeaderFooterRefs;
  footerRefs: HeaderFooterRefs;
}

export interface HeaderFooterContent {
  default?: Block[];
  first?: Block[];
  even?: Block[];
}

export interface SectionModel {
  props: SectionProps;
  blocks: Block[];
  headers: HeaderFooterContent;
  footers: HeaderFooterContent;
}

export interface DocModel {
  sections: SectionModel[];
  evenAndOdd: boolean;
  defaultTab: number; // twips
  // w:compatibilityMode (12 = Word 2007 layout, 15 = Word 2013+).
  compatMode: number;
  warnings: string[];
  faces: Set<string>;
  styles: StyleSheet;
}

// ---- parse context -------------------------------------------------------------------

interface Ctx {
  pkg: DocxPackage;
  partPath: string;
  rels: Awaited<ReturnType<DocxPackage["relationships"]>>;
  styles: StyleSheet;
  numbering: Numbering;
  fontFamilies: Map<string, string>;
  warnings: Set<string>;
  faces: Set<string>;
  media: { count: number; bytes: number };
  // Table-style formatting the current cell content inherits.
  cellFormat?: { ppr: PPr; rpr: RPr };
}

const MAX_IMAGES = 400;
const MAX_TOTAL_IMAGE_BYTES = 120 * 1024 * 1024;
const EMU_PER_PT = 12700;

const HIGHLIGHTS: Record<string, string> = {
  yellow: "FFFF00", green: "00FF00", cyan: "00FFFF", magenta: "FF00FF", blue: "0000FF", red: "FF0000",
  darkBlue: "000080", darkCyan: "008080", darkGreen: "008000", darkMagenta: "800080", darkRed: "800000",
  darkYellow: "808000", darkGray: "808080", lightGray: "C0C0C0", black: "000000", white: "FFFFFF",
};

function warn(ctx: Ctx, message: string): void {
  ctx.warnings.add(message);
}

// ---- entry ---------------------------------------------------------------------------

export async function parseDocx(pkg: DocxPackage): Promise<DocModel> {
  const docPath = "word/document.xml";
  const doc = await pkg.xml(docPath);
  if (!doc?.documentElement) throw new Error("no document part");
  const body = child(doc.documentElement, "body");
  if (!body) throw new Error("no body");

  const rels = await pkg.relationships(docPath);
  let themePath = "word/theme/theme1.xml";
  for (const rel of rels.values()) if (rel.type.endsWith("/theme")) themePath = rel.target;

  const styles = StyleSheet.parse(await pkg.xml("word/styles.xml"), await pkg.xml(themePath));
  const numbering = Numbering.parse(await pkg.xml("word/numbering.xml"));
  const settings = await pkg.xml("word/settings.xml");
  const defaultTab = attrNum(child(settings?.documentElement ?? null, "defaultTabStop"), "val") ?? 720;
  const evenAndOdd = toggle(settings?.documentElement ?? null, "evenAndOddHeaders") ?? false;
  let compatMode = 12;
  for (const cs of descendants(child(settings?.documentElement ?? null, "compat"), "compatSetting")) {
    if (attr(cs, "name") === "compatibilityMode") compatMode = attrNum(cs, "val") ?? compatMode;
  }

  const fontFamilies = new Map<string, string>();
  const fontTable = await pkg.xml("word/fontTable.xml");
  for (const f of childrenNamed(fontTable?.documentElement ?? null, "font")) {
    const name = attr(f, "name");
    const family = attr(child(f, "family"), "val");
    if (name && family) fontFamilies.set(name.toLowerCase(), family);
  }

  const ctx: Ctx = {
    pkg,
    partPath: docPath,
    rels,
    styles,
    numbering,
    fontFamilies,
    warnings: new Set(),
    faces: new Set(),
    media: { count: 0, bytes: 0 },
  };
  // Styles that carry a list (List Bullet, ...) tell us their numId.
  for (const s of styles.styles.values()) {
    if (s.ppr.numId !== undefined && s.ppr.numId > 0) numbering.styleLinks.set(s.id, { numId: s.ppr.numId, ilvl: s.ppr.ilvl ?? 0 });
  }

  // Walk the body, closing a section at every paragraph that carries a sectPr.
  const sections: SectionModel[] = [];
  let current: Block[] = [];
  const bodyBlocks = await parseBlocks(body, ctx);
  for (const block of bodyBlocks) {
    current.push(block);
    if (block.kind === "p" && block.sect) {
      sections.push({ props: block.sect, blocks: current, headers: {}, footers: {} });
      current = [];
    }
  }
  const finalSect = parseSectPr(child(body, "sectPr"));
  if (current.length > 0 || sections.length === 0) {
    sections.push({ props: finalSect, blocks: current, headers: {}, footers: {} });
  } else {
    // The last paragraph closed the final section itself; the body-level sectPr
    // describes it, replacing the paragraph-level one.
    sections[sections.length - 1].props = finalSect;
  }

  // Headers and footers inherit from the previous section when not restated.
  let previous: SectionModel | null = null;
  for (const section of sections) {
    for (const kind of ["default", "first", "even"] as const) {
      const hRef = section.props.headerRefs[kind];
      const fRef = section.props.footerRefs[kind];
      section.headers[kind] = hRef ? await loadHeaderFooter(hRef, ctx) : previous?.headers[kind];
      section.footers[kind] = fRef ? await loadHeaderFooter(fRef, ctx) : previous?.footers[kind];
    }
    previous = section;
  }

  return { sections, evenAndOdd, defaultTab, compatMode, warnings: [...ctx.warnings], faces: ctx.faces, styles };
}

async function loadHeaderFooter(rId: string, ctx: Ctx): Promise<Block[] | undefined> {
  const rel = ctx.rels.get(rId);
  if (!rel || rel.external) return undefined;
  const part = await ctx.pkg.xml(rel.target);
  if (!part?.documentElement) return undefined;
  const partCtx: Ctx = { ...ctx, partPath: rel.target, rels: await ctx.pkg.relationships(rel.target), cellFormat: undefined };
  return parseBlocks(part.documentElement, partCtx);
}

function parseSectPr(el: Element | null): SectionProps {
  const pgSz = child(el, "pgSz");
  const pgMar = child(el, "pgMar");
  const cols = child(el, "cols");
  const colEls = childrenNamed(cols, "col");
  const equal = attr(cols, "equalWidth");
  const refs = (name: string): HeaderFooterRefs => {
    const out: HeaderFooterRefs = {};
    for (const r of childrenNamed(el, name)) {
      const type = (attr(r, "type") ?? "default") as keyof HeaderFooterRefs;
      const id = attr(r, "id");
      if (id) out[type] = id;
    }
    return out;
  };
  let w = attrNum(pgSz, "w") ?? 12240;
  let h = attrNum(pgSz, "h") ?? 15840;
  // Some producers write a landscape page with the sides not swapped.
  if (attr(pgSz, "orient") === "landscape" && w < h) [w, h] = [h, w];
  return {
    pageW: w,
    pageH: h,
    top: attrNum(pgMar, "top") ?? 1440,
    bottom: attrNum(pgMar, "bottom") ?? 1440,
    left: attrNum(pgMar, "left") ?? 1440,
    right: attrNum(pgMar, "right") ?? 1440,
    header: attrNum(pgMar, "header") ?? 708,
    footer: attrNum(pgMar, "footer") ?? 708,
    gutter: attrNum(pgMar, "gutter") ?? 0,
    colCount: Math.max(1, attrNum(cols, "num") ?? 1),
    colSpace: attrNum(cols, "space") ?? 720,
    colWidths:
      equal === "0" && colEls.length > 0
        ? colEls.map((c) => attrNum(c, "w") ?? 0)
        : null,
    type: attr(child(el, "type"), "val") ?? "nextPage",
    titlePg: child(el, "titlePg") !== null,
    pgNumStart: attrNum(child(el, "pgNumType"), "start"),
    headerRefs: refs("headerReference"),
    footerRefs: refs("footerReference"),
  };
}

// ---- blocks --------------------------------------------------------------------------

async function parseBlocks(container: Element, ctx: Ctx): Promise<Block[]> {
  const out: Block[] = [];
  for (const el of kids(container)) {
    switch (el.localName) {
      case "p": {
        out.push(await parseParagraph(el, ctx));
        break;
      }
      case "tbl": {
        const table = await parseTable(el, ctx);
        if (table) out.push(table);
        break;
      }
      case "sdt": {
        const content = child(el, "sdtContent");
        if (content) out.push(...(await parseBlocks(content, ctx)));
        break;
      }
      case "customXml":
      case "ins":
      case "moveTo": {
        out.push(...(await parseBlocks(el, ctx)));
        break;
      }
      case "altChunk":
        warn(ctx, "Embedded document parts (altChunk) were skipped.");
        break;
      default:
        break;
    }
  }
  return out;
}

// ---- runs and styles -----------------------------------------------------------------

function resolveRunStyle(ctx: Ctx, rpr: RPr): RunStyle {
  const fontName = ctx.styles.fontName(rpr.fonts) ?? ctx.styles.theme.minor ?? "Times New Roman";
  const family = pickFamily(fontName, ctx.fontFamilies.get(fontName.toLowerCase()));
  const sizeHalf = rpr.sz ?? 20;
  const style: RunStyle = {
    family,
    fontName,
    size: sizeHalf / 2,
    bold: rpr.b ?? false,
    italic: rpr.i ?? false,
    underline: rpr.u && rpr.u !== "none" ? rpr.u : null,
    strike: rpr.strike ?? false,
    doubleStrike: rpr.dstrike ?? false,
    color: !rpr.color || rpr.color === "auto" ? "000000" : rpr.color,
    highlight: rpr.highlight && rpr.highlight !== "none" ? (HIGHLIGHTS[rpr.highlight] ?? null) : null,
    shading: rpr.shd && rpr.shd !== "auto" ? rpr.shd : null,
    caps: rpr.caps ?? false,
    smallCaps: rpr.smallCaps ?? false,
    vert: rpr.vertAlign === "superscript" ? "super" : rpr.vertAlign === "subscript" ? "sub" : null,
    charSpacing: (rpr.spacing ?? 0) / 20,
    raise: (rpr.position ?? 0) / 2,
    hidden: rpr.vanish ?? false,
    scale: (rpr.scale ?? 100) / 100,
  };
  if (!isMetricCompatible(fontName)) noteSubstitution(ctx, fontName, family);
  ctx.faces.add(faceKey(family, style.bold, style.italic));
  return style;
}

const FAMILY_LABEL: Record<FamilyKey, string> = {
  carlito: "Carlito",
  caladea: "Caladea",
  arimo: "Arimo",
  tinos: "Tinos",
  cousine: "Cousine",
};

const substituted = new WeakMap<Ctx["warnings"], Set<string>>();

function noteSubstitution(ctx: Ctx, fontName: string, family: FamilyKey): void {
  let seen = substituted.get(ctx.warnings);
  if (!seen) {
    seen = new Set();
    substituted.set(ctx.warnings, seen);
  }
  if (seen.has(fontName)) return;
  seen.add(fontName);
  warn(ctx, `Font "${fontName}" isn't available in the browser, so ${FAMILY_LABEL[family]} was used. Line and page breaks may differ slightly.`);
}

// ---- paragraphs ----------------------------------------------------------------------

async function parseParagraph(el: Element, ctx: Ctx): Promise<Paragraph> {
  const pPrEl = child(el, "pPr");
  const direct = parsePPr(pPrEl);
  const styleId = attr(child(pPrEl, "pStyle"), "val") ?? undefined;
  const styleProps = ctx.styles.paragraphStyleProps(styleId);

  // Precedence: defaults < table style < paragraph style < (numbering) < direct.
  let ppr = mergePPr(ctx.styles.defaultsP, ctx.cellFormat?.ppr);
  ppr = mergePPr(ppr, styleProps.ppr);

  let numId = direct.numId ?? styleProps.ppr.numId;
  const styleLink = styleId ? ctx.numbering.styleLinks.get(styleId) : undefined;
  if (numId === undefined && styleLink && styleLink.numId > 0) numId = styleLink.numId;
  const ilvl = direct.ilvl ?? styleProps.ppr.ilvl ?? styleLink?.ilvl ?? 0;
  let numLabel: { label: string; level: NumberingLevel } | null = null;
  if (numId !== undefined && numId > 0) {
    numLabel = ctx.numbering.next(numId, ilvl);
    if (numLabel) {
      // Numbering indents beat the style's when numbering is applied directly.
      if (direct.numId !== undefined) ppr = mergePPr(ppr, numLabel.level.ppr);
      else ppr = mergePPr(numLabel.level.ppr, stripNumbering(ppr));
    }
  }
  ppr = mergePPr(ppr, direct);

  // Run defaults for this paragraph.
  let baseR = mergeRPr(ctx.styles.defaultsR, ctx.cellFormat?.rpr);
  baseR = mergeRPr(baseR, styleProps.rpr);

  const markR = mergeRPr(baseR, parseRPr(child(pPrEl, "rPr")));
  const paragraph: Paragraph = {
    kind: "p",
    ppr,
    styleId,
    inlines: [],
    markStyle: resolveRunStyle(ctx, markR),
  };

  if (numLabel) {
    // The label takes the paragraph mark's formatting unless the level says otherwise.
    paragraph.numbering = { label: numLabel.label, level: numLabel.level, style: resolveRunStyle(ctx, mergeRPr(markR, numLabel.level.rpr)) };
  }

  const sect = child(pPrEl, "sectPr");
  if (sect) paragraph.sect = parseSectPr(sect);

  const fieldState: FieldFrame[] = [];
  await parseInlineChildren(el, ctx, baseR, paragraph, { link: undefined, fields: fieldState });
  return paragraph;
}

function stripNumbering(ppr: PPr): PPr {
  const { numId: _n, ilvl: _l, ...rest } = ppr;
  void _n;
  void _l;
  return rest;
}

interface FieldFrame {
  instr: string;
  phase: "instr" | "result";
  link?: string;
  kind: "page" | "numpages" | null;
  emitted: boolean;
}

interface InlineState {
  link?: string;
  fields: FieldFrame[];
}

async function parseInlineChildren(
  container: Element,
  ctx: Ctx,
  baseR: RPr,
  paragraph: Paragraph,
  state: InlineState,
): Promise<void> {
  for (const el of kids(container)) {
    switch (el.localName) {
      case "r":
        await parseRun(el, ctx, baseR, paragraph, state);
        break;
      case "hyperlink": {
        const rid = attr(el, "id");
        const rel = rid ? ctx.rels.get(rid) : undefined;
        const anchor = attr(el, "anchor");
        const link = rel?.external ? rel.target : anchor ? `#${anchor}` : undefined;
        await parseInlineChildren(el, ctx, baseR, paragraph, { ...state, link: link ?? state.link });
        break;
      }
      case "fldSimple": {
        const instr = attr(el, "instr") ?? "";
        const kind = fieldKind(instr);
        if (kind) {
          const runEl = child(el, "r");
          const cached = textOf(child(runEl, "t"));
          const rpr = mergeRPr(baseR, parseRPr(child(runEl, "rPr")));
          paragraph.inlines.push({ t: "field", kind, style: resolveRunStyle(ctx, rpr), cached });
        } else {
          await parseInlineChildren(el, ctx, baseR, paragraph, state);
        }
        break;
      }
      case "ins":
      case "smartTag":
      case "sdt":
      case "customXml":
      case "moveTo": {
        const content = el.localName === "sdt" ? child(el, "sdtContent") : el;
        if (content) await parseInlineChildren(content, ctx, baseR, paragraph, state);
        break;
      }
      case "sdtContent":
        await parseInlineChildren(el, ctx, baseR, paragraph, state);
        break;
      case "AlternateContent": {
        const choice = child(el, "Choice") ?? child(el, "Fallback");
        if (choice) await parseInlineChildren(choice, ctx, baseR, paragraph, state);
        break;
      }
      default:
        // del, moveFrom, bookmarks, proofing marks, comment ranges: nothing to draw.
        break;
    }
  }
}

function fieldKind(instr: string): "page" | "numpages" | null {
  const name = instr.trim().split(/\s+/)[0]?.toUpperCase();
  if (name === "PAGE") return "page";
  if (name === "NUMPAGES" || name === "SECTIONPAGES") return "numpages";
  return null;
}

async function parseRun(
  run: Element,
  ctx: Ctx,
  baseR: RPr,
  paragraph: Paragraph,
  state: InlineState,
): Promise<void> {
  const rPrEl = child(run, "rPr");
  const rStyleId = attr(child(rPrEl, "rStyle"), "val");
  let rpr = baseR;
  if (rStyleId) rpr = mergeRPr(rpr, ctx.styles.characterStyleProps(rStyleId));
  rpr = mergeRPr(rpr, parseRPr(rPrEl));
  const style = resolveRunStyle(ctx, rpr);

  const activeField = state.fields[state.fields.length - 1];
  const inInstruction = activeField?.phase === "instr";
  const link = state.link ?? activeField?.link;

  for (const el of kids(run)) {
    switch (el.localName) {
      case "fldChar": {
        const type = attr(el, "fldCharType");
        if (type === "begin") state.fields.push({ instr: "", phase: "instr", kind: null, emitted: false });
        else if (type === "separate") {
          const frame = state.fields[state.fields.length - 1];
          if (frame) {
            frame.phase = "result";
            frame.kind = fieldKind(frame.instr);
            const m = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(frame.instr);
            if (m) frame.link = m[1];
            if (frame.kind && !frame.emitted) {
              frame.emitted = true;
              paragraph.inlines.push({ t: "field", kind: frame.kind, style, cached: "" });
            }
          }
        } else if (type === "end") state.fields.pop();
        break;
      }
      case "instrText": {
        const frame = state.fields[state.fields.length - 1];
        if (frame && frame.phase === "instr") frame.instr += textOf(el);
        break;
      }
      case "t": {
        if (inInstruction || activeField?.kind) break; // cached result of a page-number field
        if (style.hidden) break;
        // A literal tab inside the text is a tab stop, as Word treats it.
        const parts = textOf(el).split(String.fromCharCode(9));
        parts.forEach((part, i) => {
          if (i > 0) paragraph.inlines.push({ t: "tab", style });
          if (part) paragraph.inlines.push({ t: "text", text: part, style, link });
        });
        break;
      }
      case "tab":
        if (!inInstruction && !style.hidden) paragraph.inlines.push({ t: "tab", style });
        break;
      case "br": {
        const type = attr(el, "type");
        paragraph.inlines.push({ t: "br", kind: type === "page" ? "page" : type === "column" ? "column" : "line", style });
        break;
      }
      case "cr":
        paragraph.inlines.push({ t: "br", kind: "line", style });
        break;
      case "noBreakHyphen":
        paragraph.inlines.push({ t: "text", text: "-", style, link });
        break;
      case "softHyphen":
        break;
      case "sym": {
        const font = attr(el, "font") ?? "";
        const char = attr(el, "char") ?? "";
        const code = parseInt(char, 16);
        paragraph.inlines.push({ t: "text", text: symbolToText(font, code), style, link });
        break;
      }
      case "drawing":
        await parseDrawing(el, ctx, style, paragraph, link);
        break;
      case "pict":
        await parsePict(el, ctx, style, paragraph, link);
        break;
      case "AlternateContent": {
        // A drawing offered with a fallback: use the first branch that has one.
        const choice = child(el, "Choice") ?? child(el, "Fallback");
        for (const inner of kids(choice)) {
          if (inner.localName === "drawing") await parseDrawing(inner, ctx, style, paragraph, link);
          else if (inner.localName === "pict") await parsePict(inner, ctx, style, paragraph, link);
        }
        break;
      }
      case "footnoteReference":
      case "endnoteReference":
        warn(ctx, "Footnotes and endnotes aren't shown.");
        break;
      case "object":
        warn(ctx, "Embedded objects (charts, equations, other files) can't be shown and were skipped.");
        break;
      default:
        break;
    }
  }
}

// Symbol-font bullets and a few common symbols, as real characters.
function symbolToText(font: string, code: number): string {
  const c = code & 0xff;
  if (/symbol/i.test(font)) {
    if (c === 0xb7) return String.fromCharCode(0x2022);
    if (c === 0xa8) return String.fromCharCode(0x2666);
  }
  if (/wingdings/i.test(font)) {
    if (c === 0xfc) return String.fromCharCode(0x2713);
    if (c === 0xa7 || c === 0x6e) return String.fromCharCode(0x25a0);
    if (c === 0x6c) return String.fromCharCode(0x25cf);
  }
  return code >= 0x20 && code < 0xf000 ? String.fromCharCode(code) : String.fromCharCode(0x2022);
}

// ---- images --------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
  tif: "image/tiff",
  tiff: "image/tiff",
};

async function loadMedia(ctx: Ctx, rid: string | null): Promise<{ data: Uint8Array; mime: string } | null> {
  if (!rid) return null;
  const rel = ctx.rels.get(rid);
  if (!rel || rel.external) return null;
  if (ctx.media.count >= MAX_IMAGES) return null;
  const data = await ctx.pkg.bytes(rel.target);
  if (!data) return null;
  ctx.media.count += 1;
  ctx.media.bytes += data.length;
  if (ctx.media.bytes > MAX_TOTAL_IMAGE_BYTES) return null;
  const ext = rel.target.split(".").pop()?.toLowerCase() ?? "";
  return { data, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
}

async function parseDrawing(
  drawing: Element,
  ctx: Ctx,
  style: RunStyle,
  paragraph: Paragraph,
  link: string | undefined,
): Promise<void> {
  const holder = child(drawing, "inline") ?? child(drawing, "anchor");
  if (!holder) return;
  const isAnchor = holder.localName === "anchor";
  const extent = child(holder, "extent");
  const cx = attrNum(extent, "cx") ?? 0;
  const cy = attrNum(extent, "cy") ?? 0;
  const description = attr(child(holder, "docPr"), "descr") ?? "";

  const blips = descendants(holder, "blip");
  const blip = blips[0];
  const embed = blip ? attr(blip, "embed") : null;
  if (!blip || !embed) {
    if (descendants(holder, "txbxContent").length > 0) warn(ctx, "Text boxes aren't reproduced and were skipped.");
    else if (descendants(holder, "chart").length > 0) warn(ctx, "Charts can't be reproduced and were skipped.");
    else warn(ctx, "Some drawings or shapes can't be reproduced and were skipped.");
    return;
  }
  const media = await loadMedia(ctx, embed);
  if (!media) {
    warn(ctx, "A picture could not be read and was skipped.");
    return;
  }
  const srcRect = descendants(holder, "srcRect")[0];
  const pct = (name: string) => (attrNum(srcRect, name) ?? 0) / 100000;
  const crop = srcRect ? { l: pct("l"), t: pct("t"), r: pct("r"), b: pct("b") } : null;
  const xfrm = descendants(holder, "xfrm")[0];
  const rotation = (attrNum(xfrm, "rot") ?? 0) / 60000;

  let anchor: AnchorInfo | null = null;
  if (isAnchor) {
    const posH = child(holder, "positionH");
    const posV = child(holder, "positionV");
    const wrapEl = kids(holder).find((k) => k.localName.startsWith("wrap"));
    const wrapName = wrapEl?.localName ?? "wrapNone";
    anchor = {
      behind: attr(holder, "behindDoc") === "1",
      wrap:
        wrapName === "wrapSquare"
          ? "square"
          : wrapName === "wrapTopAndBottom"
            ? "topAndBottom"
            : wrapName === "wrapTight"
              ? "tight"
              : wrapName === "wrapThrough"
                ? "through"
                : "none",
      hRel: attr(posH, "relativeFrom") ?? "column",
      vRel: attr(posV, "relativeFrom") ?? "paragraph",
      hAlign: textOf(child(posH, "align")) || null,
      vAlign: textOf(child(posV, "align")) || null,
      hOffsetPt: Number(textOf(child(posH, "posOffset")) || 0) / EMU_PER_PT,
      vOffsetPt: Number(textOf(child(posV, "posOffset")) || 0) / EMU_PER_PT,
    };
  }

  paragraph.inlines.push({
    t: "image",
    style,
    link,
    image: {
      data: media.data,
      mime: media.mime,
      widthPt: cx / EMU_PER_PT,
      heightPt: cy / EMU_PER_PT,
      crop,
      rotation,
      anchor,
      description,
    },
  });
}

// Legacy VML pictures (older files and fallbacks).
async function parsePict(
  pict: Element,
  ctx: Ctx,
  style: RunStyle,
  paragraph: Paragraph,
  link: string | undefined,
): Promise<void> {
  const imageData = descendants(pict, "imagedata")[0];
  if (!imageData) {
    if (descendants(pict, "textbox").length > 0) warn(ctx, "Text boxes aren't reproduced and were skipped.");
    return;
  }
  const media = await loadMedia(ctx, attr(imageData, "id"));
  if (!media) return;
  const shape = descendants(pict, "shape")[0] ?? descendants(pict, "rect")[0];
  const styleText = attr(shape, "style") ?? "";
  const size = (name: string): number => {
    const m = new RegExp(`${name}:\\s*([\\d.]+)(pt|in|cm|mm|px)?`).exec(styleText);
    if (!m) return 0;
    const v = Number(m[1]);
    switch (m[2]) {
      case "in":
        return v * 72;
      case "cm":
        return (v / 2.54) * 72;
      case "mm":
        return (v / 25.4) * 72;
      case "px":
        return v * 0.75;
      default:
        return v;
    }
  };
  const w = size("width");
  const h = size("height");
  if (!w || !h) return;
  paragraph.inlines.push({
    t: "image",
    style,
    link,
    image: { data: media.data, mime: media.mime, widthPt: w, heightPt: h, crop: null, rotation: 0, anchor: null, description: "" },
  });
}

// ---- tables --------------------------------------------------------------------------

// Word-authored files carry the real defaults in their default table style;
// a file without one (some generators) has none.
const DEFAULT_CELL_MARGINS = { top: 0, left: 0, bottom: 0, right: 0 };

async function parseTable(el: Element, ctx: Ctx): Promise<Table | null> {
  const tblPrEl = child(el, "tblPr");
  const direct = parseTblPr(tblPrEl);
  const styleId = attr(child(tblPrEl, "tblStyle"), "val") ?? ctx.styles.defaultTableStyle;
  const chain = ctx.styles.chain(styleId).filter((s) => s.type === "table");

  let props: TableProps = {};
  let rowBand = 1;
  let colBand = 1;
  for (const s of chain) {
    props = mergeTable(props, s.table);
    rowBand = s.rowBand ?? rowBand;
    colBand = s.colBand ?? colBand;
  }
  props = mergeTable(props, direct);
  const look = props.look ?? { firstRow: true, lastRow: false, firstCol: true, lastCol: false, bandRow: true, bandCol: false };
  const cellMargins = { ...DEFAULT_CELL_MARGINS, ...(props.cellMargins ?? {}) };
  for (const k of ["top", "left", "bottom", "right"] as const) if (cellMargins[k] === undefined) cellMargins[k] = DEFAULT_CELL_MARGINS[k];

  const gridEls = childrenNamed(child(el, "tblGrid"), "gridCol");
  const grid = gridEls.map((g) => attrNum(g, "w") ?? 0);

  const rowEls = childrenNamed(el, "tr");
  const rows: Row[] = [];
  const lastRowIndex = rowEls.length - 1;

  for (let r = 0; r < rowEls.length; r++) {
    const rowEl = rowEls[r];
    const trPr = child(rowEl, "trPr");
    const heightEl = child(trPr, "trHeight");
    const row: Row = {
      cells: [],
      height: heightEl ? { value: attrNum(heightEl, "val") ?? 0, rule: attr(heightEl, "hRule") ?? "atLeast" } : undefined,
      isHeader: child(trPr, "tblHeader") !== null,
      cantSplit: child(trPr, "cantSplit") !== null,
    };
    let col = attrNum(child(trPr, "gridBefore"), "val") ?? 0;
    for (const cellEl of childrenNamed(rowEl, "tc")) {
      const tcPrEl = child(cellEl, "tcPr");
      const span = attrNum(child(tcPrEl, "gridSpan"), "val") ?? 1;
      const vMergeEl = child(tcPrEl, "vMerge");
      const vMerge: Cell["vMerge"] = vMergeEl ? (attr(vMergeEl, "val") === "restart" ? "restart" : "continue") : null;

      // Conditional table-style formatting for this cell's position.
      const conditions: string[] = ["wholeTbl"];
      const firstRow = look.firstRow && r === 0;
      const lastRow = look.lastRow && r === lastRowIndex;
      if (look.bandRow) {
        const bandIndex = Math.floor((r - (look.firstRow ? 1 : 0)) / Math.max(1, rowBand));
        if (!firstRow && !lastRow) conditions.push(bandIndex % 2 === 0 ? "band1Horz" : "band2Horz");
      }
      if (look.bandCol) {
        const bandIndex = Math.floor((col - (look.firstCol ? 1 : 0)) / Math.max(1, colBand));
        conditions.push(bandIndex % 2 === 0 ? "band1Vert" : "band2Vert");
      }
      if (look.firstCol && col === 0) conditions.push("firstCol");
      if (look.lastCol && col + span >= grid.length) conditions.push("lastCol");
      if (firstRow) conditions.push("firstRow");
      if (lastRow) conditions.push("lastRow");

      let cellProps: CellProps = {};
      let condPPr: PPr = {};
      let condRPr: RPr = {};
      for (const s of chain) {
        cellProps = mergeCell(cellProps, s.cell);
        for (const c of conditions) {
          const cf = s.conditional?.[c];
          if (!cf) continue;
          cellProps = mergeCell(cellProps, cf.cell);
          condPPr = mergePPr(condPPr, cf.ppr);
          condRPr = mergeRPr(condRPr, cf.rpr);
        }
      }
      // The style's whole-table paragraph/run formatting (chain-level defaults).
      for (const s of chain) {
        condPPr = mergePPr(s.ppr, condPPr);
        condRPr = mergeRPr(s.rpr, condRPr);
      }
      cellProps = mergeCell(cellProps, parseTcPr(tcPrEl));

      const cellCtx: Ctx = { ...ctx, cellFormat: { ppr: condPPr, rpr: condRPr } };
      let blocks = await parseBlocks(cellEl, cellCtx);
      if (blocks.length === 0) blocks = [emptyParagraph(cellCtx)];
      // A cell must end with a paragraph.
      if (blocks[blocks.length - 1].kind === "t") blocks.push(emptyParagraph(cellCtx));

      row.cells.push({ blocks, gridStart: col, gridSpan: span, vMerge, rowSpan: 1, props: cellProps });
      col += span;
    }
    rows.push(row);
  }

  // Vertical merges: the restart cell spans the following continue cells.
  for (let r = 0; r < rows.length; r++) {
    for (const cell of rows[r].cells) {
      if (cell.vMerge !== "restart") continue;
      let span = 1;
      for (let next = r + 1; next < rows.length; next++) {
        const below = rows[next].cells.find((c) => c.gridStart === cell.gridStart);
        if (below && below.vMerge === "continue") span += 1;
        else break;
      }
      cell.rowSpan = span;
    }
  }

  if (rows.length === 0) return null;
  // Tables without a grid: derive one from the widest row.
  const gridSize = Math.max(grid.length, ...rows.map((row) => row.cells.reduce((n, c) => Math.max(n, c.gridStart + c.gridSpan), 0)));
  while (grid.length < gridSize) grid.push(Math.round(9360 / gridSize));
  return { kind: "t", grid, rows, props, cellMargins };
}

function emptyParagraph(ctx: Ctx): Paragraph {
  const base = mergeRPr(ctx.styles.defaultsR, ctx.cellFormat?.rpr);
  const styleProps = ctx.styles.paragraphStyleProps(undefined);
  return {
    kind: "p",
    ppr: mergePPr(mergePPr(ctx.styles.defaultsP, ctx.cellFormat?.ppr), styleProps.ppr),
    inlines: [],
    markStyle: resolveRunStyle(ctx, mergeRPr(base, styleProps.rpr)),
  };
}

export type { Borders };
