// Rebuilds rows and columns from the positioned text PDF.js reports for a
// page. A PDF has no real "table" -- just strings at coordinates -- so this
// works geometrically: group strings into visual lines, split each line into
// cells wherever there's a wide gap, then find the columns that cells line up
// in across lines. Deliberately dependency-free (no PDF.js / DOM imports) so
// it stays easy to reason about and test.
//
// It is a heuristic and is honest about that: it does well on ruled and
// unruled tables of digital PDFs, and can't recover structure that isn't
// there (multi-column article layouts, cells that span columns, scans).

export interface PositionedText {
  str: string;
  // Left edge and baseline in PDF units (y grows upward, as PDF.js reports).
  x: number;
  y: number;
  width: number;
  // Roughly the font size.
  height: number;
  // Optional font details, used by PDF -> Word to keep bold/italic and the
  // rough typeface. PDF -> Excel doesn't need them.
  bold?: boolean;
  italic?: boolean;
  family?: "serif" | "sans" | "mono";
}

export interface Cell {
  text: string;
  left: number;
  right: number;
}

export interface Line {
  y: number;
  height: number;
  cells: Cell[];
  // The strings the line was built from, left to right.
  items: PositionedText[];
}

// A gap wider than this (in font heights) between two strings on a line
// starts a new cell; narrower gaps are just spaces inside one cell.
const CELL_GAP_EM = 0.9;
// A gap wider than this is a word space rather than letters touching.
const WORD_GAP_EM = 0.12;
// Strings whose baselines differ by less than this (in font heights) sit on
// the same line.
const SAME_LINE_EM = 0.45;
// A vertical gap this many line-heights or more becomes a blank row.
const BLANK_ROW_LINES = 1.9;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function groupIntoLines(items: PositionedText[]): PositionedText[][] {
  const usable = items.filter((item) => item.str.trim() !== "" && item.width >= 0);
  // Top of the page first (PDF y grows upward), then left to right.
  usable.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: { y: number; items: PositionedText[] }[] = [];
  for (const item of usable) {
    const tolerance = Math.max(1.5, item.height * SAME_LINE_EM);
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= tolerance) {
      last.items.push(item);
      // Keep the running baseline centred so long lines don't drift.
      last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  return lines.map((line) => line.items.sort((a, b) => a.x - b.x));
}

export function splitIntoCells(items: PositionedText[]): Line {
  const cells: Cell[] = [];
  const heights = items.map((item) => item.height).filter((h) => h > 0);
  const lineHeight = median(heights) || 10;

  let current: Cell | null = null;
  let previousEnd = 0;
  let previousStr = "";
  for (const item of items) {
    const text = item.str.trim();
    const itemRight = item.x + item.width;
    const em = item.height > 0 ? item.height : lineHeight;

    if (!current) {
      current = { text, left: item.x, right: itemRight };
    } else {
      const gap = item.x - previousEnd;
      if (gap > em * CELL_GAP_EM) {
        cells.push(current);
        current = { text, left: item.x, right: itemRight };
      } else {
        // Same cell. Add a space unless the strings are touching, or PDF.js
        // already carried the space on the previous string.
        const spaced = gap > em * WORD_GAP_EM || /\s$/.test(previousStr);
        current.text += (spaced ? " " : "") + text;
        current.right = Math.max(current.right, itemRight);
      }
    }
    previousEnd = itemRight;
    previousStr = item.str;
  }
  if (current) cells.push(current);

  return { y: items[0].y, height: lineHeight, cells, items };
}

// Column bands: horizontal ranges that cells from different lines overlap.
// Projecting every cell onto the x axis and merging overlaps handles left-,
// right- and centre-aligned columns alike WHEN a column's cells share an edge
// across rows. Many real tables don't: a left-aligned header ("Q1") sitting
// near a column's left edge, over a right-aligned number ("120") sitting near
// that same column's right edge, can end up with no horizontal overlap at
// all if the column is wide. Left uncorrected, that reads as two columns
// instead of one -- every such column doubles, and the row that caused it
// comes out shifted with blank cells where its neighbours don't.
//
// The fix: no row can have more cells than columns, so the true column count
// is never more than the largest number of cells any single line actually
// has. If merging overlaps alone leaves more bands than that, the header
// (or whichever row split a column in two) is the odd one out, not the
// table's shape -- so the extra bands are folded into their nearest
// neighbour, closest gap first, until the count fits.
export function findColumnBands(lines: Line[], pageWidth: number): { left: number; right: number }[] {
  // Only lines that look like table rows vote; single-cell lines are titles or
  // paragraph text and would otherwise glue every column together.
  const tableLines = lines.filter((line) => line.cells.length >= 2);
  const maxCellsPerLine = tableLines.reduce((max, line) => Math.max(max, line.cells.length), 0);
  const intervals = tableLines
    .flatMap((line) => line.cells.map((cell) => ({ left: cell.left, right: cell.right })))
    // A cell that spans much of the page is a heading, not a column.
    .filter((interval) => interval.right - interval.left < pageWidth * 0.6)
    .sort((a, b) => a.left - b.left);

  const bands: { left: number; right: number }[] = [];
  for (const interval of intervals) {
    const last = bands[bands.length - 1];
    if (last && interval.left <= last.right) {
      last.right = Math.max(last.right, interval.right);
    } else {
      bands.push({ ...interval });
    }
  }

  while (maxCellsPerLine > 0 && bands.length > maxCellsPerLine) {
    let closest = 0;
    let smallestGap = Infinity;
    for (let i = 0; i < bands.length - 1; i++) {
      const gap = bands[i + 1].left - bands[i].right;
      if (gap < smallestGap) {
        smallestGap = gap;
        closest = i;
      }
    }
    bands[closest] = { left: bands[closest].left, right: Math.max(bands[closest].right, bands[closest + 1].right) };
    bands.splice(closest + 1, 1);
  }

  return bands;
}

export function bandIndexFor(cell: Cell, bands: { left: number; right: number }[]): number {
  const centre = (cell.left + cell.right) / 2;
  let best = 0;
  let bestDistance = Infinity;
  bands.forEach((band, index) => {
    if (centre >= band.left && centre <= band.right) {
      best = index;
      bestDistance = -1;
    } else if (bestDistance >= 0) {
      const distance = Math.min(Math.abs(centre - band.left), Math.abs(centre - band.right));
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
  });
  return best;
}

// Turns one page's positioned text into a grid of strings (rows x columns).
export function extractTable(items: PositionedText[], pageWidth: number): string[][] {
  const lines = groupIntoLines(items).map(splitIntoCells);
  if (lines.length === 0) return [];

  const bands = findColumnBands(lines, pageWidth);
  const lineHeight = median(lines.map((line) => line.height)) || 10;

  const rows: string[][] = [];
  let previous: Line | null = null;
  for (const line of lines) {
    if (previous && previous.y - line.y > lineHeight * BLANK_ROW_LINES * 1.2) rows.push([]);
    previous = line;

    if (line.cells.length < 2 || bands.length === 0) {
      // Prose/title lines stay whole in the first column.
      rows.push([line.cells.map((cell) => cell.text).join(" ")]);
      continue;
    }

    const row: string[] = [];
    for (const cell of line.cells) {
      const column = bandIndexFor(cell, bands);
      row[column] = row[column] ? `${row[column]} ${cell.text}` : cell.text;
    }
    rows.push(Array.from(row, (value) => value ?? ""));
  }

  // Drop leading/trailing blank rows.
  while (rows.length && rows[0].length === 0) rows.shift();
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

export interface TypedCell {
  value: string | number;
  // Excel number format to apply (e.g. percent or currency), when detected.
  numFmt?: string;
}

// Dollar, euro, pound, yen -- by code point to keep the source ASCII.
const CURRENCY_SYMBOLS = "$" + String.fromCharCode(0x20ac, 0xa3, 0xa5);

// Converts a cell's text to a number when it clearly is one, so the workbook
// is usable for sums and charts. Deliberately conservative: anything that
// isn't unambiguously a plain number stays text -- IDs with leading zeros
// ("00123"), phone numbers, dates, long digit strings -- because silently
// changing those is worse than leaving them as text.
export function parseCellValue(raw: string): TypedCell {
  const text = raw.trim();
  if (text === "") return { value: "" };

  let body = text;
  let negative = false;
  if (/^\(.*\)$/.test(body)) {
    negative = true;
    body = body.slice(1, -1).trim();
  }
  if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1).trim();
  }

  let currency = "";
  if (CURRENCY_SYMBOLS.includes(body[0] ?? "")) {
    currency = body[0];
    body = body.slice(1).trim();
  }

  let percent = false;
  if (body.endsWith("%")) {
    percent = true;
    body = body.slice(0, -1).trim();
  }

  // Digits with optional thousands commas and decimals; nothing else.
  const grouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body);
  const plain = /^\d+(\.\d+)?$/.test(body);
  if (!grouped && !plain) return { value: text };

  const digits = body.replace(/,/g, "");
  const integerPart = digits.split(".")[0];
  // "00123" and 16+ digit strings are identifiers, not quantities.
  if ((integerPart.length > 1 && integerPart.startsWith("0")) || integerPart.length > 15) {
    return { value: text };
  }

  let value = Number(digits);
  if (!Number.isFinite(value)) return { value: text };
  if (negative) value = -value;
  if (percent) value /= 100;

  const decimals = (digits.split(".")[1] ?? "").length;
  const zeros = decimals > 0 ? `.${"0".repeat(decimals)}` : "";
  const integerFormat = grouped || currency ? "#,##0" : "0";

  let numFmt: string | undefined;
  if (percent) numFmt = `0${zeros}%`;
  else if (currency) numFmt = `"${currency}"${integerFormat}${zeros}`;
  else if (grouped || decimals > 0) numFmt = `${integerFormat}${zeros}`;

  return numFmt ? { value, numFmt } : { value };
}
