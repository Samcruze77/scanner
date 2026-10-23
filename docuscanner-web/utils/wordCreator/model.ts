// Shared facts about the Word document creator: the page, the fonts, and the small pure helpers
// (file names, link checks, colours) used by BOTH the editor and the .docx writer, so what you
// see and what is exported cannot drift apart. No browser APIs here: tests import this in Node.

// ---- the page ------------------------------------------------------------------------------------------------
// A4 at 96 dpi, with Word's default 2.54 cm margins. The browser measures in CSS pixels; Word in twips.
export const PAGE = {
  widthPx: 794,
  heightPx: 1123,
  marginPx: 96,
  // The grey strip drawn between two pages in the editor (never exported).
  gapPx: 24,
  widthTwips: 11906,
  heightTwips: 16838,
  marginTwips: 1440,
} as const;

export const CONTENT_WIDTH_PX = PAGE.widthPx - PAGE.marginPx * 2; // 602
export const CONTENT_HEIGHT_PX = PAGE.heightPx - PAGE.marginPx * 2; // 931

// ---- defaults (the editor's CSS and the .docx styles both read these) ----------------------------------------------
export const DEFAULTS = {
  fontFamily: "Calibri",
  fontSizePt: 11,
  lineHeight: 1.15,
  spaceAfterPt: 8,
} as const;

export interface StyleSpec {
  id: string;
  label: string;
  sizePt: number;
  bold: boolean;
  color?: string; // hex without #
  spaceBeforePt: number;
  spaceAfterPt: number;
}

// The paragraph styles offered in the toolbar. Headings are real Word headings in the file.
export const PARAGRAPH_STYLES: StyleSpec[] = [
  { id: "normal", label: "Normal text", sizePt: 11, bold: false, spaceBeforePt: 0, spaceAfterPt: 8 },
  { id: "title", label: "Title", sizePt: 26, bold: false, spaceBeforePt: 0, spaceAfterPt: 6 },
  { id: "subtitle", label: "Subtitle", sizePt: 14, bold: false, color: "595959", spaceBeforePt: 0, spaceAfterPt: 8 },
  { id: "h1", label: "Heading 1", sizePt: 20, bold: true, spaceBeforePt: 12, spaceAfterPt: 6 },
  { id: "h2", label: "Heading 2", sizePt: 16, bold: true, spaceBeforePt: 10, spaceAfterPt: 6 },
  { id: "h3", label: "Heading 3", sizePt: 13, bold: true, spaceBeforePt: 8, spaceAfterPt: 4 },
];

export const FONTS: { label: string; css: string }[] = [
  { label: "Arial", css: 'Arial, "Liberation Sans", Arimo, Helvetica, sans-serif' },
  { label: "Times New Roman", css: '"Times New Roman", "Liberation Serif", Tinos, Times, serif' },
  { label: "Calibri", css: 'Calibri, Carlito, "Segoe UI", sans-serif' },
  { label: "Georgia", css: "Georgia, serif" },
  { label: "Verdana", css: "Verdana, Geneva, sans-serif" },
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
export const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];
export const MAX_INDENT = 8;
export const INDENT_TWIPS = 720; // 0.5 inch per level
export const INDENT_PX = 48;

// ---- the document tree (what the editor saves; the same JSON shape ProseMirror produces) ---------------------------
export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

// ---- file names ----------------------------------------------------------------------------------------------
export const DEFAULT_TITLE = "Untitled Document";
// Zero-width and direction-control characters, built from code points so they are visible here.
const INVISIBLE = new RegExp("[" + [[0x200b,0x200f],[0x202a,0x202e],[0x2066,0x2069],[0xfeff,0xfeff]].map(([a,b])=>String.fromCodePoint(a)+"-"+String.fromCodePoint(b)).join("") + "]", "g");
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// A safe file name for the download. Keeps letters of any language; drops what Windows, macOS and
// Linux forbid, collapses spaces, and never returns an empty or reserved name.
export function sanitizeFileName(title: string, ext = ".docx"): string {
  let name = (title ?? "")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  if (Array.from(name).length > 120) name = Array.from(name).slice(0, 120).join("").trim();
  if (!name || RESERVED.test(name)) name = name ? `${name} document` : DEFAULT_TITLE;
  return name + ext;
}

// ---- links ---------------------------------------------------------------------------------------------------
const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

// Returns the link if it is safe to keep (web, mail or phone), otherwise null. This is what stops a
// pasted `javascript:` or `data:` address from ever becoming a link in the page or the file.
export function safeLinkHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  if (!href || href.length > 2048) return null;
  try {
    const url = new URL(href);
    return SAFE_PROTOCOLS.includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

// What a person typed into the "Link" box, turned into an address: adds https:// or mailto: when
// they left the scheme off.
export function normalizeLinkInput(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return safeLinkHref(text);
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text)) return safeLinkHref(`mailto:${text}`);
  return safeLinkHref(`https://${text}`);
}

// ---- colours / sizes -----------------------------------------------------------------------------------------------
// "#1a2b3c", "#abc" or "rgb(1, 2, 3)" -> "1A2B3C". Anything else (names, gradients, junk from a paste) -> null.
export function colorToHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(v);
  if (m) {
    const parts = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
    return parts.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return null;
}

// "14pt" / "14px" / 14 -> points. null when it is not a usable size.
export function sizeToPt(value: unknown): number | null {
  if (typeof value === "number") return value > 0 && value <= 400 ? value : null;
  if (typeof value !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)\s*(pt|px)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]) * (m[2]?.toLowerCase() === "px" ? 0.75 : 1);
  return n > 0 && n <= 400 ? Math.round(n * 2) / 2 : null;
}

// The first family in a CSS font stack, without quotes: what Word needs as a font name.
export function primaryFont(css: unknown): string | null {
  if (typeof css !== "string") return null;
  const first = css.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first && /^[\p{L}\p{N} _.-]{1,64}$/u.test(first) ? first : null;
}

// ---- reading a document ------------------------------------------------------------------------------------------------
// All the text in reading order, one line per block. Used for word counts and for tests.
export function plainText(node: DocNode): string {
  const lines: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === "paragraph" || n.type === "heading") {
      lines.push((n.content ?? []).map((c) => (c.type === "hardBreak" ? "\n" : (c.text ?? ""))).join(""));
      return;
    }
    n.content?.forEach(walk);
  };
  walk(node);
  return lines.join("\n");
}

export function isDocumentEmpty(doc: DocNode): boolean {
  let empty = true;
  const walk = (n: DocNode) => {
    if (!empty) return;
    if (n.type === "image" || n.type === "horizontalRule" || n.type === "pageBreak") empty = false;
    else if (n.type === "text" && n.text) empty = false;
    else n.content?.forEach(walk);
  };
  walk(doc);
  return empty;
}

export function countWords(doc: DocNode): number {
  const text = plainText(doc).trim();
  return text ? text.split(/\s+/).length : 0;
}

// ---- page margins ------------------------------------------------------------------------------------------------------------
// Margins are stored in twips (1/20 pt), exactly what Word writes. 1 CSS px = 15 twips; 1 inch = 1440 twips.
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGINS: Margins = { top: 1440, right: 1440, bottom: 1440, left: 1440 };

// Word's own presets.
export const MARGIN_PRESETS: { id: "normal" | "narrow" | "moderate" | "wide"; label: string; margins: Margins }[] = [
  { id: "normal", label: "Normal", margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
  { id: "narrow", label: "Narrow", margins: { top: 720, right: 720, bottom: 720, left: 720 } },
  { id: "moderate", label: "Moderate", margins: { top: 1440, right: 1080, bottom: 1440, left: 1080 } },
  { id: "wide", label: "Wide", margins: { top: 1440, right: 2880, bottom: 1440, left: 2880 } },
];

export const MIN_MARGIN_TWIPS = 360; // 0.25 in: most printers cannot print closer to the edge
export const MAX_MARGIN_TWIPS = 5760; // 4 in
// Whatever the margins, at least this much of the page is left for text.
export const MIN_TEXT_TWIPS = 2880; // 2 in

export const twipsToInches = (tw: number) => Math.round((tw / 1440) * 100) / 100;
export const inchesToTwips = (inches: number) => Math.round(inches * 1440);

export type MarginCheck = { ok: true; margins: Margins } | { ok: false; error: string };

// Checks margins typed by a person (or read back from a saved draft): numbers only, never negative, never so large that no
// room is left for text.
export function validateMargins(raw: unknown): MarginCheck {
  const m = raw as Partial<Record<keyof Margins, unknown>> | null;
  const out = {} as Margins;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const v = m?.[side];
    if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `Enter a number for the ${side} margin.` };
    if (v < 0) return { ok: false, error: `The ${side} margin cannot be negative.` };
    if (v < MIN_MARGIN_TWIPS) return { ok: false, error: `The ${side} margin must be at least ${twipsToInches(MIN_MARGIN_TWIPS)} in.` };
    if (v > MAX_MARGIN_TWIPS) return { ok: false, error: `The ${side} margin can be at most ${twipsToInches(MAX_MARGIN_TWIPS)} in.` };
    out[side] = Math.round(v);
  }
  if (PAGE.widthTwips - out.left - out.right < MIN_TEXT_TWIPS) return { ok: false, error: "The left and right margins leave too little room for text. Make one of them smaller." };
  if (PAGE.heightTwips - out.top - out.bottom < MIN_TEXT_TWIPS) return { ok: false, error: "The top and bottom margins leave too little room for text. Make one of them smaller." };
  return { ok: true, margins: out };
}

// A saved draft's margins, or the defaults if they are missing or damaged.
export function sanitizeMargins(raw: unknown): Margins {
  const check = validateMargins(raw);
  return check.ok ? check.margins : { ...DEFAULT_MARGINS };
}

export function marginPreset(m: Margins): "normal" | "narrow" | "moderate" | "wide" | "custom" {
  const hit = MARGIN_PRESETS.find((p) => p.margins.top === m.top && p.margins.right === m.right && p.margins.bottom === m.bottom && p.margins.left === m.left);
  return hit ? hit.id : "custom";
}

// ---- what is on screen -------------------------------------------------------------------------------------------------------
// The size of the sheet and its margins in CSS pixels, as drawn. In "page" view this is the real A4 sheet. In the narrow
// "phone" view the sheet is as wide as the screen allows (so text stays readable) with the same A4 proportions and small
// margins; the downloaded file always uses the real margins.
export interface PageGeometry {
  pageW: number;
  pageH: number;
  mt: number;
  mr: number;
  mb: number;
  ml: number;
  gap: number;
  contentW: number;
  contentH: number;
  // Bottom margin + the grey strip + top margin: the space a page break occupies between two pages' text.
  gapTotal: number;
  // Distance from the top of one page's text to the top of the next page's text.
  pitch: number;
}

export function makeGeometry(pageW: number, marginsPx: { top: number; right: number; bottom: number; left: number }, gap: number = PAGE.gapPx): PageGeometry {
  const pageH = Math.round((pageW * PAGE.heightPx) / PAGE.widthPx);
  const contentH = pageH - marginsPx.top - marginsPx.bottom;
  const gapTotal = marginsPx.bottom + gap + marginsPx.top;
  return {
    pageW,
    pageH,
    mt: marginsPx.top,
    mr: marginsPx.right,
    mb: marginsPx.bottom,
    ml: marginsPx.left,
    gap,
    contentW: pageW - marginsPx.left - marginsPx.right,
    contentH,
    gapTotal,
    pitch: contentH + gapTotal,
  };
}

export const marginsToPx = (m: Margins) => ({ top: m.top / 15, right: m.right / 15, bottom: m.bottom / 15, left: m.left / 15 });

// The real A4 sheet with the chosen margins.
export function pageViewGeometry(m: Margins): PageGeometry {
  return makeGeometry(PAGE.widthPx, marginsToPx(m));
}

// The narrow view: `width` is the room the screen has; margins shrink in proportion but stay at least 14 px.
export function phoneViewGeometry(m: Margins, width: number): PageGeometry {
  const pageW = Math.max(280, Math.round(width));
  const k = pageW / PAGE.widthPx;
  const px = marginsToPx(m);
  const scaled = { top: Math.max(14, px.top * k * 0.6), right: Math.max(14, px.right * k * 0.6), bottom: Math.max(14, px.bottom * k * 0.6), left: Math.max(14, px.left * k * 0.6) };
  return makeGeometry(pageW, { top: Math.round(scaled.top), right: Math.round(scaled.right), bottom: Math.round(scaled.bottom), left: Math.round(scaled.left) });
}

// ---- paragraph indents ---------------------------------------------------------------------------------------------------------
export const PT_PER_INCH = 72;
export const INDENT_STEP_PT = 36; // one indent step = 0.5 in
export const MAX_INDENT_PT = 360; // 5 in

// Left indent in points: an explicit value if one was set, otherwise the number of steps from the indent buttons.
export function leftIndentPt(attrs: Record<string, unknown> | undefined): number {
  const a = attrs ?? {};
  if (typeof a.indentLeft === "number" && Number.isFinite(a.indentLeft)) return Math.min(MAX_INDENT_PT, Math.max(0, a.indentLeft));
  const level = typeof a.indent === "number" ? Math.min(MAX_INDENT, Math.max(0, Math.round(a.indent))) : 0;
  return level * INDENT_STEP_PT;
}
