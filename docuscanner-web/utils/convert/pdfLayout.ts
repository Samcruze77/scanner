// Rebuilds document structure from the positioned text of one PDF page, for
// PDF -> Word. A PDF stores strings at coordinates, not paragraphs, so this is
// geometric guesswork: group strings into lines, merge lines into paragraphs,
// spot headings by size and weight, lists by their markers, tables by aligned
// columns, and centred/right-aligned text by position.
//
// It is honest about being a heuristic. It does well on ordinary reports,
// letters and forms; it cannot reproduce multi-column layouts, text wrapped
// around pictures, exact spacing, or anything drawn rather than typed.
// Dependency-free (no PDF.js / DOM), so it can be tested in isolation.

import {
  bandIndexFor,
  findColumnBands,
  groupIntoLines,
  median,
  splitIntoCells,
  type Line,
  type PositionedText,
} from "./tableExtract";

export type Family = "serif" | "sans" | "mono";

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  sizePt: number;
  family: Family;
}

export interface ParagraphBlock {
  kind: "paragraph";
  runs: Run[];
  align: "left" | "center" | "right";
  // Left indent beyond the page margin, in points.
  indentPt: number;
  // 0 = body text, 1-3 = heading level.
  heading: 0 | 1 | 2 | 3;
  list: { type: "bullet" | "number"; level: 0 | 1 } | null;
  // Extra vertical space above, in points.
  spaceBeforePt: number;
}

export interface TableBlock {
  kind: "table";
  rows: string[][];
  // Proportional column widths, summing to about the text width.
  columnWidthsPt: number[];
}

export type Block = ParagraphBlock | TableBlock;

export interface PageLayout {
  blocks: Block[];
  marginLeftPt: number;
  marginRightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
}

// ---- tuning -------------------------------------------------------------------

// New paragraph when the gap between lines exceeds this many line heights.
const PARAGRAPH_GAP = 1.5;
// Tables need at least this many consecutive multi-cell lines.
const MIN_TABLE_ROWS = 2;
// A table row may be separated from the next by up to this many line heights.
const TABLE_ROW_GAP = 2.4;
// A line that stops this far (fraction of text width) short of the right edge
// ended its paragraph.
const SHORT_LINE = 0.14;
const CENTER_TOLERANCE = 0.035;
const MIN_MARGIN_PT = 36;
const MAX_MARGIN_PT = 108;

// Bullet glyphs by code point (bullet, middle dot, small square, white bullet,
// triangular bullet, black circle, white circle, black/white square, arrow
// bullets, and the private-use codes Word's Symbol/Wingdings bullets extract
// as), plus hyphen, en dash, em dash and asterisk -- so no look-alike
// characters live in the source.
const GLYPHS = String.fromCharCode(0x2022, 0xb7, 0x25aa, 0x25e6, 0x2023, 0x25cf, 0x25cb, 0x25a0, 0x25a1, 0x27a2, 0x25ba, 0xf0b7, 0xf0a7, 0xf0d8, 0xf0fc);
const DASHES = "-" + String.fromCharCode(0x2013, 0x2014) + "*";
const BULLET_MARKER = new RegExp(`^([${GLYPHS}]|[${DASHES}])$`);
const NUMBER_MARKER = /^(\d{1,3}[.)]|\(?[a-z][.)]|[ivx]{1,5}[.)])$/;
// Marker glued to the start of the text ("- item", "1. item", "a) item").
const INLINE_MARKER = new RegExp(
  "^([" + GLYPHS + "]|[" + DASHES + String.raw`]|\d{1,3}[.)]|\(?[a-z][.)])\s+(\S.*)$`,
);

interface Marker {
  type: "bullet" | "number";
  text: string;
}

function markerOf(token: string): Marker | null {
  if (BULLET_MARKER.test(token)) return { type: "bullet", text: token };
  if (NUMBER_MARKER.test(token)) return { type: "number", text: token };
  return null;
}

// ---- helpers --------------------------------------------------------------------

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Typical body-text size of the document: the size most characters are set in.
export function estimateBodySize(pages: PositionedText[][]): number {
  const sizes: number[] = [];
  for (const items of pages) {
    for (const item of items) {
      const chars = item.str.trim().length;
      if (chars === 0 || item.height < 4) continue;
      // Weight by character count so a big heading doesn't outvote a paragraph.
      const weight = Math.min(chars, 60);
      for (let i = 0; i < weight; i += 6) sizes.push(Math.round(item.height * 2) / 2);
    }
  }
  return sizes.length ? median(sizes) : 11;
}

interface Row {
  line: Line;
  text: string;
  left: number;
  right: number;
  size: number;
  boldRatio: number;
  marker: Marker | null;
  // True when the marker was its own string (so it is not part of `items`).
  markerSeparate: boolean;
  // Where the text (after any marker) starts.
  textLeft: number;
  // Items after the marker, for building runs.
  items: PositionedText[];
}

function toRow(line: Line): Row {
  let cells = line.cells;
  let items = line.items.filter((i) => i.str.trim() !== "");
  let marker: Marker | null = null;
  let markerSeparate = false;

  // "•" or "1." sitting alone in the first cell, with the text in the next one.
  if (cells.length >= 2) {
    const m = markerOf(cells[0].text.trim());
    if (m) {
      marker = m;
      markerSeparate = true;
      const rest = cells.slice(1);
      items = items.filter((i) => i.x >= cells[1].left - 0.5);
      cells = [{ text: rest.map((c) => c.text).join(" "), left: rest[0].left, right: rest[rest.length - 1].right }];
    }
  }
  // Marker glued to the text.
  if (!marker && cells.length === 1) {
    const m = INLINE_MARKER.exec(cells[0].text);
    if (m) {
      const token = markerOf(m[1]);
      if (token) marker = token;
    }
  }

  const heights = items.map((i) => i.height).filter((h) => h > 0);
  const chars = items.reduce((n, i) => n + i.str.trim().length, 0) || 1;
  const boldChars = items.reduce((n, i) => n + (i.bold ? i.str.trim().length : 0), 0);
  return {
    line,
    text: cells.map((c) => c.text).join(cells.length > 1 ? "    " : ""),
    left: line.cells[0].left,
    right: line.cells[line.cells.length - 1].right,
    size: median(heights) || 11,
    boldRatio: boldChars / chars,
    marker,
    markerSeparate,
    textLeft: cells[0].left,
    items,
  };
}

// Turns a paragraph's lines into styled runs, adding spaces where strings were
// set apart, and healing words a line break split with a hyphen.
function buildRuns(rows: Row[], stripMarker: boolean): Run[] {
  const runs: Run[] = [];
  const push = (text: string, item: PositionedText) => {
    if (!text) return;
    const style = {
      bold: !!item.bold,
      italic: !!item.italic,
      sizePt: Math.round(item.height * 2) / 2,
      family: item.family ?? "sans",
    };
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic && last.sizePt === style.sizePt && last.family === style.family) {
      last.text += text;
    } else {
      runs.push({ text, ...style });
    }
  };

  rows.forEach((row, rowIndex) => {
    const items = row.items;
    let previous: PositionedText | null = null;
    items.forEach((item, itemIndex) => {
      let text = item.str;
      // List items lose their marker (Word draws its own); headings keep it.
      if (rowIndex === 0 && itemIndex === 0 && row.marker && stripMarker && !row.markerSeparate) {
        const inline = INLINE_MARKER.exec(text.trim());
        if (inline && markerOf(inline[1])) text = inline[2];
        else if (markerOf(text.trim())) text = "";
      }
      if (!text.trim()) {
        previous = item;
        return;
      }
      if (previous) {
        const em = item.height > 0 ? item.height : 10;
        const gap = item.x - (previous.x + previous.width);
        const spaced = gap > em * 0.12 || /\s$/.test(previous.str) || /^\s/.test(text);
        if (spaced) push(" ", previous);
      } else if (rowIndex > 0) {
        // New line inside a paragraph: a space, unless a hyphen split a word.
        const lastRun = runs[runs.length - 1];
        if (lastRun && /[a-z]-$/.test(lastRun.text) && /^[a-z]/.test(text.trim())) {
          lastRun.text = lastRun.text.slice(0, -1);
        } else {
          push(" ", item);
        }
      }
      if (rowIndex === 0 && itemIndex === 0 && row.marker && !stripMarker && row.markerSeparate) {
        push(`${row.marker.text} `, item);
      }
      push(text.trim(), item);
      previous = item;
    });
  });

  // Trim the outer edges and drop empties.
  if (runs.length) runs[0].text = runs[0].text.replace(/^\s+/, "");
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  return runs.filter((r) => r.text !== "");
}

// ---- page layout -----------------------------------------------------------------

export function layoutPage(
  items: PositionedText[],
  pageWidth: number,
  pageHeight: number,
  bodySize: number,
): PageLayout {
  const lines = groupIntoLines(items).map(splitIntoCells);
  const rows = lines.map(toRow).filter((r) => r.text.trim() !== "");

  const empty: PageLayout = { blocks: [], marginLeftPt: 72, marginRightPt: 72, marginTopPt: 72, marginBottomPt: 72 };
  if (rows.length === 0) return empty;

  // Margins from where text actually sits.
  const lefts = rows.map((r) => r.textLeft);
  const rights = rows.map((r) => r.right);
  const textLeft = percentile(lefts, 0.1);
  const textRight = Math.max(percentile(rights, 0.9), textLeft + pageWidth * 0.3);
  const textWidth = textRight - textLeft;
  const topMost = Math.max(...items.filter((i) => i.str.trim()).map((i) => i.y + i.height));
  const bottomMost = Math.min(...items.filter((i) => i.str.trim()).map((i) => i.y));

  const layout: PageLayout = {
    blocks: [],
    marginLeftPt: clamp(textLeft, MIN_MARGIN_PT, MAX_MARGIN_PT),
    marginRightPt: clamp(pageWidth - textRight, MIN_MARGIN_PT, MAX_MARGIN_PT),
    marginTopPt: clamp(pageHeight - topMost, MIN_MARGIN_PT, MAX_MARGIN_PT),
    marginBottomPt: clamp(bottomMost, MIN_MARGIN_PT, MAX_MARGIN_PT),
  };

  const pageCenter = pageWidth / 2;
  const isTableRow = (r: Row) => !r.marker && r.line.cells.length >= 2;

  let index = 0;
  while (index < rows.length) {
    // ---- table: consecutive multi-cell lines
    if (isTableRow(rows[index])) {
      let end = index;
      while (
        end + 1 < rows.length &&
        isTableRow(rows[end + 1]) &&
        rows[end].line.y - rows[end + 1].line.y <= rows[end].size * TABLE_ROW_GAP * 1.2
      ) {
        end++;
      }
      if (end - index + 1 >= MIN_TABLE_ROWS) {
        const tableLines = rows.slice(index, end + 1).map((r) => r.line);
        const bands = findColumnBands(tableLines, pageWidth);
        if (bands.length >= 2) {
          const table = tableLines.map((line) => {
            const row: string[] = [];
            for (const cell of line.cells) {
              const col = bandIndexFor(cell, bands);
              row[col] = row[col] ? `${row[col]} ${cell.text}` : cell.text;
            }
            return Array.from(row, (v) => v ?? "");
          });
          const widths = bands.map((band, i) => (i < bands.length - 1 ? bands[i + 1].left - band.left : Math.max(textRight - band.left, band.right - band.left + 8)));
          layout.blocks.push({ kind: "table", rows: table, columnWidthsPt: widths });
          index = end + 1;
          continue;
        }
      }
    }

    // ---- paragraph: merge following lines that continue it
    const start = index;
    const first = rows[index];
    const group: Row[] = [first];
    const centred = (r: Row) => Math.abs((r.left + r.right) / 2 - pageCenter) <= pageWidth * CENTER_TOLERANCE && r.left > textLeft + textWidth * 0.08;
    let next = index + 1;
    while (next < rows.length) {
      const prev = group[group.length - 1];
      const row = rows[next];
      if (isTableRow(row) && next + 1 < rows.length && isTableRow(rows[next + 1])) break;
      const gap = prev.line.y - row.line.y;
      const lineHeight = Math.max(prev.size, row.size) * 1.2;
      const sizeChanged = Math.abs(row.size - prev.size) > Math.max(1, prev.size * 0.12);
      const weightChanged = Math.abs(row.boldRatio - prev.boldRatio) > 0.6;
      const prevEndedShort = prev.right < textRight - textWidth * SHORT_LINE;
      const alignmentChanged = centred(prev) !== centred(row);
      const indentedStart = row.textLeft - prev.textLeft > 12 && !centred(row);
      if (
        row.marker ||
        gap > lineHeight * PARAGRAPH_GAP ||
        sizeChanged ||
        weightChanged ||
        alignmentChanged ||
        indentedStart ||
        (prevEndedShort && !centred(prev))
      ) {
        break;
      }
      group.push(row);
      next++;
    }

    const size = median(group.map((r) => r.size));
    const allBold = group.every((r) => r.boldRatio > 0.7);
    const textLength = group.reduce((n, r) => n + r.text.length, 0);
    // A large or bold short line is a heading even if it starts "1." -- that is
    // a section number, not a list item.
    let heading: 0 | 1 | 2 | 3 = 0;
    if (group.length <= 3 && textLength <= 140) {
      if (size >= bodySize * 1.6) heading = 1;
      else if (size >= bodySize * 1.3) heading = 2;
      else if (size >= bodySize * 1.12 || (allBold && size >= bodySize * 0.98 && textLength <= 80)) heading = 3;
    }
    const isList = !!first.marker && heading === 0;

    const runs = buildRuns(group, isList);
    index = next;
    if (runs.length === 0) continue;

    const align: ParagraphBlock["align"] = group.every(centred)
      ? "center"
      : group.every((r) => r.right >= textRight - textWidth * 0.03 && r.left > textLeft + textWidth * 0.4)
        ? "right"
        : "left";
    const indentPt = align === "left" ? clamp(Math.round(Math.min(...group.map((r) => r.textLeft)) - textLeft), 0, 220) : 0;

    const above = start > 0 ? rows[start - 1] : null;
    const gapAbove = above ? above.line.y - first.line.y - first.size * 1.2 : 0;

    layout.blocks.push({
      kind: "paragraph",
      runs,
      align,
      indentPt,
      heading,
      list: isList && first.marker ? { type: first.marker.type, level: indentPt >= 28 ? 1 : 0 } : null,
      spaceBeforePt: clamp(Math.round(gapAbove), 0, 30),
    });
  }

  return layout;
}
