// Parses styles.xml and theme fonts, and resolves the effective properties of a
// paragraph, run or table cell by walking Word's inheritance chain:
// document defaults -> table style -> paragraph style (basedOn chain) ->
// numbering level -> character style -> direct formatting.

import type {
  Border,
  Borders,
  CellProps,
  ConditionalFormat,
  PPr,
  RPr,
  StyleDef,
  TabStop,
  TableProps,
} from "./types.ts";
import { attr, attrNum, child, childrenNamed, kids, toggle } from "./xml.ts";

// ---- property parsers --------------------------------------------------------------

export function parseBorder(el: Element | null): Border | undefined {
  if (!el) return undefined;
  const val = attr(el, "val") ?? "single";
  return {
    val,
    sz: attrNum(el, "sz") ?? 4,
    color: attr(el, "color") ?? "auto",
    space: attrNum(el, "space") ?? 0,
  };
}

export function parseBorders(el: Element | null): Borders | undefined {
  if (!el) return undefined;
  const out: Borders = {};
  const map: [keyof Borders, string[]][] = [
    ["top", ["top"]],
    ["left", ["left", "start"]],
    ["bottom", ["bottom"]],
    ["right", ["right", "end"]],
    ["between", ["between"]],
    ["insideH", ["insideH"]],
    ["insideV", ["insideV"]],
  ];
  for (const [key, names] of map) {
    for (const name of names) {
      const b = parseBorder(child(el, name));
      if (b) {
        out[key] = b;
        break;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function shdFill(el: Element | null): string | undefined {
  const shd = child(el, "shd");
  if (!shd) return undefined;
  const fill = attr(shd, "fill");
  const val = attr(shd, "val");
  // "clear" shading shows the fill; solid pattern colours use `color`.
  if (val === "solid") return attr(shd, "color") ?? fill ?? undefined;
  return fill ?? undefined;
}

export function parseRPr(el: Element | null): RPr {
  const out: RPr = {};
  if (!el) return out;
  const fonts = child(el, "rFonts");
  if (fonts) {
    out.fonts = {
      ascii: attr(fonts, "ascii") ?? undefined,
      hAnsi: attr(fonts, "hAnsi") ?? undefined,
      eastAsia: attr(fonts, "eastAsia") ?? undefined,
      cs: attr(fonts, "cs") ?? undefined,
      asciiTheme: attr(fonts, "asciiTheme") ?? undefined,
      hAnsiTheme: attr(fonts, "hAnsiTheme") ?? undefined,
    };
  }
  const sz = attrNum(child(el, "sz"), "val");
  if (sz !== undefined) out.sz = sz;
  const b = toggle(el, "b");
  if (b !== undefined) out.b = b;
  const i = toggle(el, "i");
  if (i !== undefined) out.i = i;
  const u = child(el, "u");
  if (u) out.u = attr(u, "val") ?? "single";
  const strike = toggle(el, "strike");
  if (strike !== undefined) out.strike = strike;
  const dstrike = toggle(el, "dstrike");
  if (dstrike !== undefined) out.dstrike = dstrike;
  const color = child(el, "color");
  if (color) out.color = attr(color, "val") ?? undefined;
  const hl = child(el, "highlight");
  if (hl) out.highlight = attr(hl, "val") ?? undefined;
  const shd = shdFill(el);
  if (shd) out.shd = shd;
  const caps = toggle(el, "caps");
  if (caps !== undefined) out.caps = caps;
  const smallCaps = toggle(el, "smallCaps");
  if (smallCaps !== undefined) out.smallCaps = smallCaps;
  const va = child(el, "vertAlign");
  if (va) out.vertAlign = attr(va, "val") ?? undefined;
  const spacing = attrNum(child(el, "spacing"), "val");
  if (spacing !== undefined) out.spacing = spacing;
  const position = attrNum(child(el, "position"), "val");
  if (position !== undefined) out.position = position;
  const scale = attrNum(child(el, "w"), "val");
  if (scale !== undefined) out.scale = scale;
  const vanish = toggle(el, "vanish");
  if (vanish !== undefined) out.vanish = vanish;
  return out;
}

export function parsePPr(el: Element | null): PPr {
  const out: PPr = {};
  if (!el) return out;
  const jc = attr(child(el, "jc"), "val");
  if (jc) out.jc = jc;
  const ind = child(el, "ind");
  if (ind) {
    out.indLeft = attrNum(ind, "left") ?? attrNum(ind, "start");
    out.indRight = attrNum(ind, "right") ?? attrNum(ind, "end");
    out.indFirstLine = attrNum(ind, "firstLine");
    out.indHanging = attrNum(ind, "hanging");
    // Character-unit indents (leftChars, ...) are rare; twips win when present.
  }
  const sp = child(el, "spacing");
  if (sp) {
    out.before = attrNum(sp, "before");
    out.after = attrNum(sp, "after");
    out.line = attrNum(sp, "line");
    const rule = attr(sp, "lineRule");
    if (rule) out.lineRule = rule;
    const ba = attr(sp, "beforeAutospacing");
    const aa = attr(sp, "afterAutospacing");
    if (ba !== null) out.beforeAutospacing = ba === "1" || ba === "true";
    if (aa !== null) out.afterAutospacing = aa === "1" || aa === "true";
  }
  const keepNext = toggle(el, "keepNext");
  if (keepNext !== undefined) out.keepNext = keepNext;
  const keepLines = toggle(el, "keepLines");
  if (keepLines !== undefined) out.keepLines = keepLines;
  const pbb = toggle(el, "pageBreakBefore");
  if (pbb !== undefined) out.pageBreakBefore = pbb;
  const widow = toggle(el, "widowControl");
  if (widow !== undefined) out.widowControl = widow;
  const ctx = toggle(el, "contextualSpacing");
  if (ctx !== undefined) out.contextualSpacing = ctx;
  const tabs = child(el, "tabs");
  if (tabs) {
    out.tabs = childrenNamed(tabs, "tab").map((t) => {
      const rawKind = attr(t, "val") ?? "left";
      const leader = attr(t, "leader");
      return {
        pos: attrNum(t, "pos") ?? 0,
        kind: (rawKind === "start" ? "left" : rawKind === "end" ? "right" : rawKind) as TabStop["kind"],
        leader: leader === "dot" || leader === "hyphen" || leader === "underscore" || leader === "middleDot" ? leader : "none",
      };
    });
  }
  const numPr = child(el, "numPr");
  if (numPr) {
    const id = attrNum(child(numPr, "numId"), "val");
    if (id !== undefined) out.numId = id;
    const lvl = attrNum(child(numPr, "ilvl"), "val");
    if (lvl !== undefined) out.ilvl = lvl;
  }
  const shd = shdFill(el);
  if (shd) out.shd = shd;
  const borders = parseBorders(child(el, "pBdr"));
  if (borders) out.borders = borders;
  const outline = attrNum(child(el, "outlineLvl"), "val");
  if (outline !== undefined) out.outlineLvl = outline;
  const markRPr = child(el, "rPr");
  if (markRPr) out.markRPr = parseRPr(markRPr);
  return out;
}

function parseMargins(el: Element | null): CellProps["margins"] | undefined {
  if (!el) return undefined;
  const m: NonNullable<CellProps["margins"]> = {};
  m.top = attrNum(child(el, "top"), "w");
  m.left = attrNum(child(el, "left"), "w") ?? attrNum(child(el, "start"), "w");
  m.bottom = attrNum(child(el, "bottom"), "w");
  m.right = attrNum(child(el, "right"), "w") ?? attrNum(child(el, "end"), "w");
  return m;
}

export function parseTcPr(el: Element | null): CellProps {
  const out: CellProps = {};
  if (!el) return out;
  const shd = shdFill(el);
  if (shd) out.shd = shd;
  const borders = parseBorders(child(el, "tcBorders"));
  if (borders) out.borders = borders;
  const va = attr(child(el, "vAlign"), "val");
  if (va) out.vAlign = va;
  const mar = parseMargins(child(el, "tcMar"));
  if (mar) out.margins = mar;
  return out;
}

export function parseTblPr(el: Element | null): TableProps {
  const out: TableProps = {};
  if (!el) return out;
  const borders = parseBorders(child(el, "tblBorders"));
  if (borders) out.borders = borders;
  const mar = parseMargins(child(el, "tblCellMar"));
  if (mar) out.cellMargins = mar;
  const jc = attr(child(el, "jc"), "val");
  if (jc) out.jc = jc;
  const ind = attrNum(child(el, "tblInd"), "w");
  if (ind !== undefined) out.indent = ind;
  const spacing = attrNum(child(el, "tblCellSpacing"), "w");
  if (spacing !== undefined) out.cellSpacing = spacing;
  const w = child(el, "tblW");
  if (w) {
    const raw = attr(w, "w") ?? "";
    out.widthType = attr(w, "type") ?? "auto";
    if (raw.endsWith("%")) {
      // Some generators write "100%" instead of fiftieths of a percent.
      out.widthType = "pct";
      out.width = parseFloat(raw) * 50;
    } else {
      out.width = attrNum(w, "w");
    }
  }
  const layout = attr(child(el, "tblLayout"), "type");
  if (layout) out.layoutFixed = layout === "fixed";
  const look = child(el, "tblLook");
  if (look) {
    const val = attr(look, "val");
    const bit = (mask: number, name: string): boolean => {
      const explicit = attr(look, name);
      if (explicit !== null) return explicit === "1" || explicit === "true";
      return val ? (parseInt(val, 16) & mask) !== 0 : false;
    };
    out.look = {
      firstRow: bit(0x20, "firstRow"),
      lastRow: bit(0x40, "lastRow"),
      firstCol: bit(0x80, "firstColumn"),
      lastCol: bit(0x100, "lastColumn"),
      bandRow: !bit(0x200, "noHBand"),
      bandCol: !bit(0x400, "noVBand"),
    };
  }
  return out;
}

// ---- merging ---------------------------------------------------------------------

function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function mergeBorders(a: Borders | undefined, b: Borders | undefined): Borders | undefined {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b };
}

export function mergeRPr(base: RPr, over: RPr | undefined): RPr {
  if (!over) return base;
  const out: RPr = { ...base, ...defined(over) };
  if (base.fonts || over.fonts) out.fonts = { ...base.fonts, ...defined(over.fonts ?? {}) };
  return out;
}

export function mergePPr(base: PPr, over: PPr | undefined): PPr {
  if (!over) return base;
  const out: PPr = { ...base, ...defined(over) };
  out.borders = mergeBorders(base.borders, over.borders);
  if (base.tabs || over.tabs) {
    const merged = new Map<number, TabStop>();
    for (const t of base.tabs ?? []) merged.set(t.pos, t);
    for (const t of over.tabs ?? []) {
      if (t.kind === "clear") merged.delete(t.pos);
      else merged.set(t.pos, t);
    }
    out.tabs = [...merged.values()].sort((x, y) => x.pos - y.pos);
  }
  if (base.markRPr || over.markRPr) out.markRPr = mergeRPr(base.markRPr ?? {}, over.markRPr);
  return out;
}

export function mergeCell(base: CellProps, over: CellProps | undefined): CellProps {
  if (!over) return base;
  const out: CellProps = { ...base, ...defined(over) };
  out.borders = mergeBorders(base.borders, over.borders);
  if (base.margins || over.margins) out.margins = { ...base.margins, ...defined(over.margins ?? {}) };
  return out;
}

export function mergeTable(base: TableProps, over: TableProps | undefined): TableProps {
  if (!over) return base;
  const out: TableProps = { ...base, ...defined(over) };
  out.borders = mergeBorders(base.borders, over.borders);
  if (base.cellMargins || over.cellMargins) out.cellMargins = { ...base.cellMargins, ...defined(over.cellMargins ?? {}) };
  return out;
}

// ---- style sheet -------------------------------------------------------------------

export interface Theme {
  major?: string;
  minor?: string;
}

export class StyleSheet {
  defaultsP: PPr = {};
  defaultsR: RPr = {};
  styles = new Map<string, StyleDef>();
  defaultParagraphStyle?: string;
  defaultTableStyle?: string;
  theme: Theme = {};

  static parse(stylesDoc: Document | null, themeDoc: Document | null): StyleSheet {
    const sheet = new StyleSheet();
    if (themeDoc?.documentElement) sheet.theme = parseTheme(themeDoc.documentElement);
    const root = stylesDoc?.documentElement;
    if (!root) return sheet;

    const docDefaults = child(root, "docDefaults");
    sheet.defaultsR = parseRPr(child(child(docDefaults, "rPrDefault"), "rPr"));
    sheet.defaultsP = parsePPr(child(child(docDefaults, "pPrDefault"), "pPr"));

    for (const s of childrenNamed(root, "style")) {
      const id = attr(s, "styleId");
      if (!id) continue;
      const type = attr(s, "type") ?? "paragraph";
      const def: StyleDef = {
        id,
        type,
        name: attr(child(s, "name"), "val") ?? id,
        basedOn: attr(child(s, "basedOn"), "val") ?? undefined,
        isDefault: attr(s, "default") === "1" || attr(s, "default") === "true",
        ppr: parsePPr(child(s, "pPr")),
        rpr: parseRPr(child(s, "rPr")),
      };
      if (type === "table") {
        def.table = parseTblPr(child(s, "tblPr"));
        def.cell = parseTcPr(child(s, "tcPr"));
        def.rowBand = attrNum(child(child(s, "tblPr"), "tblStyleRowBandSize"), "val") ?? 1;
        def.colBand = attrNum(child(child(s, "tblPr"), "tblStyleColBandSize"), "val") ?? 1;
        const conditional: Record<string, ConditionalFormat> = {};
        for (const c of childrenNamed(s, "tblStylePr")) {
          const kind = attr(c, "type");
          if (!kind) continue;
          conditional[kind] = {
            ppr: parsePPr(child(c, "pPr")),
            rpr: parseRPr(child(c, "rPr")),
            cell: parseTcPr(child(c, "tcPr")),
          };
          // Conditional table formatting can also carry table-level borders.
          const tblPr = child(c, "tblPr");
          if (tblPr) {
            const t = parseTblPr(tblPr);
            if (t.borders) conditional[kind].cell = mergeCell(conditional[kind].cell, { borders: t.borders });
          }
        }
        def.conditional = conditional;
      }
      sheet.styles.set(id, def);
      if (def.isDefault && type === "paragraph") sheet.defaultParagraphStyle = id;
      if (def.isDefault && type === "table") sheet.defaultTableStyle = id;
    }
    return sheet;
  }

  // basedOn chain, base-most first. Guards against cycles.
  chain(id: string | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let current = id ? this.styles.get(id) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      out.unshift(current);
      current = current.basedOn ? this.styles.get(current.basedOn) : undefined;
    }
    return out;
  }

  paragraphStyleProps(styleId: string | undefined): { ppr: PPr; rpr: RPr } {
    let ppr: PPr = {};
    let rpr: RPr = {};
    for (const s of this.chain(styleId ?? this.defaultParagraphStyle)) {
      ppr = mergePPr(ppr, s.ppr);
      rpr = mergeRPr(rpr, s.rpr);
    }
    return { ppr, rpr };
  }

  characterStyleProps(styleId: string | undefined): RPr {
    let rpr: RPr = {};
    for (const s of this.chain(styleId)) rpr = mergeRPr(rpr, s.rpr);
    return rpr;
  }

  // Font family name for a run, honouring theme font references.
  fontName(fonts: RPr["fonts"]): string | undefined {
    if (!fonts) return undefined;
    const themeRef = fonts.asciiTheme ?? fonts.hAnsiTheme;
    if (themeRef) {
      const isMajor = themeRef.startsWith("major");
      const themed = isMajor ? this.theme.major : this.theme.minor;
      if (themed) return themed;
    }
    return fonts.ascii ?? fonts.hAnsi ?? fonts.cs ?? fonts.eastAsia;
  }
}

function parseTheme(root: Element): Theme {
  const out: Theme = {};
  const fontScheme = findDeep(root, "fontScheme");
  if (fontScheme) {
    out.major = attr(child(child(fontScheme, "majorFont"), "latin"), "typeface") ?? undefined;
    out.minor = attr(child(child(fontScheme, "minorFont"), "latin"), "typeface") ?? undefined;
  }
  return out;
}

function findDeep(el: Element, name: string): Element | null {
  for (const k of kids(el)) {
    if (k.localName === name) return k;
    const f = findDeep(k, name);
    if (f) return f;
  }
  return null;
}
