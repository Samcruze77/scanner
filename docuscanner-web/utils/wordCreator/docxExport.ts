// Turns the editor's document tree into a real Word (.docx) file with the `docx` library.
//
// Nothing here goes through HTML or a screenshot: every paragraph, heading, list, run of text,
// link and picture in the tree becomes the matching Word element, so the file is editable in
// Word. Text is copied exactly as typed (the only change is removing characters XML cannot hold).
import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Tab,
  TextRun,
  UnderlineType,
  type ILevelsOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import { bytesFromDataUrl, sniffImage } from "./imageData.ts";
import {
  DEFAULT_MARGINS,
  DEFAULTS,
  INDENT_TWIPS,
  MAX_INDENT,
  PAGE,
  PARAGRAPH_STYLES,
  leftIndentPt,
  validateMargins,
  type Margins,
  colorToHex,
  primaryFont,
  safeLinkHref,
  sizeToPt,
  type DocMark,
  type DocNode,
} from "./model.ts";

export class ExportError extends Error {}

interface Ctx {
  orderedInstances: number;
  // A page break was just read: the next paragraph written starts a new page.
  pendingBreak: boolean;
  // Width of the text area in pixels, for keeping pictures inside the margins.
  contentWidthPx: number;
}

// Hands the pending page break to the paragraph being written (once).
function takeBreak(ctx: Ctx): boolean {
  const b = ctx.pendingBreak;
  ctx.pendingBreak = false;
  return b;
}

// Characters that are not allowed in an XML document at all (they would make Word refuse the file).
const XML_ILLEGAL = new RegExp(`[${[[0, 8], [11, 12], [14, 31]].map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("")}]`, "g");

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- text -----------------------------------------------------------------------------------------------------------
function runOptions(marks: DocMark[] | undefined): IRunOptions {
  const o: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = {};
  for (const mark of marks ?? []) {
    const a = mark.attrs ?? {};
    switch (mark.type) {
      case "bold":
        o.bold = true;
        break;
      case "italic":
        o.italics = true;
        break;
      case "underline":
        o.underline = { type: UnderlineType.SINGLE };
        break;
      case "strike":
        o.strike = true;
        break;
      case "superscript":
        o.superScript = true;
        break;
      case "subscript":
        o.subScript = true;
        break;
      case "highlight": {
        const fill = colorToHex(a.color) ?? "FFFF00";
        o.shading = { type: ShadingType.CLEAR, fill, color: "auto" };
        break;
      }
      case "textStyle": {
        const font = primaryFont(a.fontFamily);
        if (font) o.font = font;
        const size = sizeToPt(a.fontSize);
        if (size) o.size = Math.round(size * 2);
        const color = colorToHex(a.color);
        if (color) o.color = color;
        const bg = colorToHex(a.backgroundColor);
        if (bg) o.shading = { type: ShadingType.CLEAR, fill: bg, color: "auto" };
        break;
      }
    }
  }
  return o;
}

function textRun(text: string, marks: DocMark[] | undefined, extra: IRunOptions = {}): TextRun {
  const clean = text.replace(XML_ILLEGAL, "");
  const parts = clean.split("\t");
  const children: (string | Tab)[] = [];
  parts.forEach((part, i) => {
    if (i > 0) children.push(new Tab());
    if (part) children.push(part);
  });
  return new TextRun({ ...runOptions(marks), ...extra, children });
}

function linkOf(marks: DocMark[] | undefined): string | null {
  const m = marks?.find((x) => x.type === "link");
  return m ? safeLinkHref(m.attrs?.href) : null;
}

function inlineChildren(nodes: DocNode[] | undefined): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let linkRuns: TextRun[] = [];
  let linkHref: string | null = null;
  const flush = () => {
    if (linkRuns.length && linkHref) out.push(new ExternalHyperlink({ link: linkHref, children: linkRuns }));
    linkRuns = [];
    linkHref = null;
  };
  for (const n of nodes ?? []) {
    if (n.type === "text" && typeof n.text === "string") {
      const href = linkOf(n.marks);
      if (href) {
        if (linkHref !== href) flush();
        linkHref = href;
        linkRuns.push(textRun(n.text, n.marks, { style: "Hyperlink" }));
      } else {
        flush();
        out.push(textRun(n.text, n.marks));
      }
    } else if (n.type === "hardBreak") {
      flush();
      out.push(new TextRun({ break: 1 }));
    }
  }
  flush();
  return out;
}

// ---- paragraphs -------------------------------------------------------------------------------------------------------
function paragraphLayout(node: DocNode, inList: boolean) {
  const a = node.attrs ?? {};
  const spacing: { before?: number; after?: number; line?: number; lineRule?: (typeof LineRuleType)[keyof typeof LineRuleType] } = {};
  const before = num(a.spaceBefore);
  const after = num(a.spaceAfter);
  const line = num(a.lineHeight);
  if (before !== null && before >= 0) spacing.before = Math.round(before * 20);
  if (after !== null && after >= 0) spacing.after = Math.round(after * 20);
  if (line !== null && line > 0) {
    spacing.line = Math.round(line * 240);
    spacing.lineRule = LineRuleType.AUTO;
  }
  const left = Math.round(leftIndentPt(a) * 20);
  const right = Math.round(Math.max(0, Math.min(MAX_INDENT * INDENT_TWIPS, (num(a.indentRight) ?? 0) * 20)));
  const first = Math.round(Math.max(-left, Math.min(MAX_INDENT * INDENT_TWIPS, (num(a.firstLine) ?? 0) * 20)));
  const indent: { left?: number; right?: number; firstLine?: number; hanging?: number } = {};
  if (left > 0) indent.left = left;
  if (right > 0) indent.right = right;
  if (first > 0) indent.firstLine = first;
  else if (first < 0) indent.hanging = -first;
  return {
    alignment: typeof a.textAlign === "string" ? ALIGN[a.textAlign] : undefined,
    spacing: Object.keys(spacing).length ? spacing : undefined,
    indent: !inList && Object.keys(indent).length ? indent : undefined,
  };
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

function textBlock(node: DocNode, inList: boolean, extra: { numbering?: { reference: string; level: number; instance?: number }; indentLeft?: number; pageBreakBefore?: boolean } = {}): Paragraph {
  const layout = paragraphLayout(node, inList);
  const base = {
    children: inlineChildren(node.content),
    alignment: layout.alignment,
    spacing: layout.spacing,
    indent: extra.indentLeft !== undefined ? { left: extra.indentLeft } : layout.indent,
    numbering: extra.numbering,
    ...(extra.pageBreakBefore ? { pageBreakBefore: true } : {}),
  };
  if (node.type === "heading") {
    const level = Math.min(3, Math.max(1, Math.round(num(node.attrs?.level) ?? 1)));
    return new Paragraph({ ...base, heading: HEADINGS[level - 1] });
  }
  const variant = node.attrs?.variant;
  if (variant === "title") return new Paragraph({ ...base, style: "Title" });
  if (variant === "subtitle") return new Paragraph({ ...base, style: "Subtitle" });
  return new Paragraph(base);
}

function imageBlock(node: DocNode, ctx: Ctx, listIndent?: number): Paragraph {
  const bytes = bytesFromDataUrl(node.attrs?.src);
  const info = bytes ? sniffImage(bytes) : null;
  if (!bytes || !info || !info.width || !info.height) {
    throw new ExportError("A picture in the document could not be read, so the file was not created. Remove the picture and add it again.");
  }
  const requested = num(node.attrs?.width) ?? info.width;
  const width = Math.max(8, Math.min(ctx.contentWidthPx, Math.round(requested)));
  const height = Math.max(1, Math.round((width * info.height) / info.width));
  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
  const align = typeof node.attrs?.align === "string" ? ALIGN[node.attrs.align] : undefined;
  const type = info.mime === "image/png" ? "png" : info.mime === "image/gif" ? "gif" : "jpg";
  return new Paragraph({
    alignment: align,
    ...(takeBreak(ctx) ? { pageBreakBefore: true } : {}),
    indent: listIndent !== undefined ? { left: listIndent } : undefined,
    children: [new ImageRun({ type, data: bytes, transformation: { width, height }, altText: { name: "Picture", title: alt, description: alt } })],
  });
}

// ---- lists ------------------------------------------------------------------------------------------------------------
function listBlocks(list: DocNode, depth: number, ctx: Ctx): Paragraph[] {
  const ordered = list.type === "orderedList";
  const instance = ordered ? ++ctx.orderedInstances : undefined;
  const reference = ordered ? "numbers" : "bullets";
  const out: Paragraph[] = [];
  const textLeft = INDENT_TWIPS * (depth + 1);
  for (const item of list.content ?? []) {
    let numbered = false;
    for (const child of item.content ?? []) {
      if (child.type === "paragraph" || child.type === "heading") {
        out.push(
          numbered
            ? textBlock(child, true, { indentLeft: textLeft })
            : textBlock(child, true, { numbering: { reference, level: Math.min(depth, 8), instance }, pageBreakBefore: takeBreak(ctx) }),
        );
        numbered = true;
      } else if (child.type === "bulletList" || child.type === "orderedList") {
        out.push(...listBlocks(child, depth + 1, ctx));
      } else if (child.type === "image") {
        out.push(imageBlock(child, ctx, textLeft));
      }
    }
  }
  return out;
}

function levels(ordered: boolean): ILevelsOptions[] {
  const bullets = ["•", "◦", "▪"];
  const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: ordered ? formats[level % 3] : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : bullets[level % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: INDENT_TWIPS * (level + 1), hanging: 360 } } },
  }));
}

// ---- the document ---------------------------------------------------------------------------------------------------
export interface ExportOptions {
  title?: string;
  // Page margins in twips. Checked here too, so a bad value can never produce a file Word refuses.
  margins?: Margins;
}

export function buildDocument(doc: DocNode, options: ExportOptions = {}): Document {
  const checked = options.margins ? validateMargins(options.margins) : null;
  const margins: Margins = checked && checked.ok ? checked.margins : DEFAULT_MARGINS;
  const ctx: Ctx = { orderedInstances: 0, pendingBreak: false, contentWidthPx: Math.round((PAGE.widthTwips - margins.left - margins.right) / 15) };
  const children: Paragraph[] = [];
  for (const node of doc.content ?? []) {
    switch (node.type) {
      case "paragraph":
      case "heading":
        children.push(textBlock(node, false, { pageBreakBefore: takeBreak(ctx) }));
        break;
      case "bulletList":
      case "orderedList":
        children.push(...listBlocks(node, 0, ctx));
        break;
      case "image":
        children.push(imageBlock(node, ctx));
        break;
      case "pageBreak":
        // A break right after another (or before any text) leaves a blank page: it needs a paragraph of its own to sit on.
        if (ctx.pendingBreak || children.length === 0) children.push(new Paragraph(ctx.pendingBreak ? { pageBreakBefore: true } : {}));
        ctx.pendingBreak = true;
        break;
      case "horizontalRule":
        children.push(
          new Paragraph({
            ...(takeBreak(ctx) ? { pageBreakBefore: true } : {}),
            spacing: { before: 120, after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, space: 1, color: "808080" } },
          }),
        );
        break;
    }
  }
  // A page break at the very end still opens a page to continue on.
  if (ctx.pendingBreak) children.push(new Paragraph({ pageBreakBefore: true }));
  if (!children.length) children.push(new Paragraph({}));

  const styleOf = (id: string) => PARAGRAPH_STYLES.find((s) => s.id === id)!;
  const paragraphStyle = (id: string, docxId: string, name: string, outlineLevel?: number) => {
    const s = styleOf(id);
    return {
      id: docxId,
      name,
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      run: { size: s.sizePt * 2, bold: s.bold, ...(s.color ? { color: s.color } : {}) },
      paragraph: { spacing: { before: s.spaceBeforePt * 20, after: s.spaceAfterPt * 20 }, keepNext: id !== "normal", keepLines: true, ...(outlineLevel !== undefined ? { outlineLevel } : {}) },
    };
  };

  return new Document({
    creator: "FreePDFScanner",
    title: options.title || undefined,
    styles: {
      default: {
        document: {
          run: { font: DEFAULTS.fontFamily, size: DEFAULTS.fontSizePt * 2 },
          paragraph: { spacing: { after: DEFAULTS.spaceAfterPt * 20, line: Math.round(DEFAULTS.lineHeight * 240), lineRule: LineRuleType.AUTO } },
        },
      },
      paragraphStyles: [
        paragraphStyle("title", "Title", "Title"),
        paragraphStyle("subtitle", "Subtitle", "Subtitle"),
        paragraphStyle("h1", "Heading1", "heading 1", 0),
        paragraphStyle("h2", "Heading2", "heading 2", 1),
        paragraphStyle("h3", "Heading3", "heading 3", 2),
      ],
      characterStyles: [{ id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", run: { color: "0563C1", underline: { type: UnderlineType.SINGLE } } }],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: levels(false) },
        { reference: "numbers", levels: levels(true) },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.widthTwips, height: PAGE.heightTwips },
            margin: { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left },
          },
        },
        children,
      },
    ],
  });
}

export async function exportDocx(doc: DocNode, options: ExportOptions = {}): Promise<Uint8Array> {
  const buffer = await Packer.toArrayBuffer(buildDocument(doc, options));
  return new Uint8Array(buffer);
}
