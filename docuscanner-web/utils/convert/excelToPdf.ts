"use client";

// Excel -> PDF, entirely in the browser. ExcelJS reads the workbook; jsPDF
// draws it as paginated tables that keep what people actually rely on: the
// displayed values (with Excel number/date formats applied), column widths,
// row heights, fonts (bold/italic/size/colour), fills, borders, alignment,
// wrapped text and merged cells.
//
// It is a table renderer, not a spreadsheet engine: charts, images, shapes,
// conditional formatting and text outside the Latin alphabet are not carried
// over (callers surface those limits to the user).

import type ExcelJS from "exceljs";
import type { jsPDF } from "jspdf";
import { formatDate, formatNumber, isDateFormat } from "./excelFormat";
import { loadExcelJs, type ExcelJsModule } from "./loadExcelJs";

export const MAX_EXCEL_FILE_BYTES = 15 * 1024 * 1024;
// Rows across all selected sheets; keeps a runaway file from freezing a tab.
export const MAX_EXCEL_ROWS = 20_000;

export type ExcelErrorCode =
  | "excel_unsupported_type"
  | "excel_legacy_xls"
  | "excel_too_large"
  | "excel_too_many_rows"
  | "excel_unreadable"
  | "excel_no_data";

export class ExcelConvertError extends Error {
  readonly code: ExcelErrorCode;
  constructor(code: ExcelErrorCode) {
    super(code);
    this.name = "ExcelConvertError";
    this.code = code;
  }
}

export interface SheetInfo {
  name: string;
  rows: number;
  columns: number;
}

export interface LoadedWorkbook {
  workbook: ExcelJS.Workbook;
  sheets: SheetInfo[];
  // Sheets that contain pictures, which won't appear in the PDF.
  sheetsWithImages: string[];
}

export type Orientation = "auto" | "portrait" | "landscape";

export interface ExcelToPdfOptions {
  sheetNames: string[];
  orientation: Orientation;
  showGridlines: boolean;
  onProgress?: (fraction: number) => void;
}

export interface ExcelToPdfResult {
  blob: Blob;
  pageCount: number;
  // Things that didn't survive the conversion, worded for the user.
  warnings: string[];
}

type RGB = [number, number, number];

// ---- loading ---------------------------------------------------------------

// Small RFC 4180 CSV reader (quotes, escaped quotes, CRLF), picking the
// delimiter from the header line so semicolon/tab exports work too.
export function parseCsv(text: string): string[][] {
  const source = text.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as keyof typeof counts]++;
  }
  const delimiter = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as string) || ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  inQuotes = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function extractsOf(worksheet: ExcelJS.Worksheet): { lastRow: number; lastColumn: number } {
  let lastRow = 0;
  let lastColumn = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (!row.hasValues) return;
    lastRow = Math.max(lastRow, rowNumber);
    row.eachCell({ includeEmpty: false }, (_cell, columnNumber) => {
      lastColumn = Math.max(lastColumn, columnNumber);
    });
  });
  // A merged range can reach past the last cell that holds a value.
  for (const range of (worksheet.model as { merges?: string[] }).merges ?? []) {
    const [, end] = range.split(":");
    const match = end ? /^([A-Z]+)(\d+)$/.exec(end) : null;
    if (match) {
      lastRow = Math.max(lastRow, Number(match[2]));
      lastColumn = Math.max(lastColumn, columnLettersToNumber(match[1]));
    }
  }
  return { lastRow, lastColumn };
}

function columnLettersToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export async function loadWorkbook(file: File): Promise<LoadedWorkbook> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) throw new ExcelConvertError("excel_legacy_xls");
  const isCsv = name.endsWith(".csv") || file.type === "text/csv";
  const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xlsm");
  if (!isCsv && !isXlsx) throw new ExcelConvertError("excel_unsupported_type");
  if (file.size > MAX_EXCEL_FILE_BYTES) throw new ExcelConvertError("excel_too_large");

  const { Workbook } = await loadExcelJs();
  const workbook = new Workbook();
  try {
    if (isCsv) {
      const worksheet = workbook.addWorksheet("Sheet1");
      for (const row of parseCsv(await file.text())) {
        worksheet.addRow(row.map((value) => (value === "" ? null : value)));
      }
    } else {
      await workbook.xlsx.load(await file.arrayBuffer());
    }
  } catch {
    throw new ExcelConvertError("excel_unreadable");
  }

  const sheets: SheetInfo[] = [];
  const sheetsWithImages: string[] = [];
  for (const worksheet of workbook.worksheets) {
    // Hidden sheets stay hidden, as in Excel's own print/export.
    if (worksheet.state !== "visible") continue;
    const { lastRow, lastColumn } = extractsOf(worksheet);
    sheets.push({ name: worksheet.name, rows: lastRow, columns: lastColumn });
    if (worksheet.getImages().length > 0) sheetsWithImages.push(worksheet.name);
  }
  if (sheets.every((sheet) => sheet.rows === 0)) throw new ExcelConvertError("excel_no_data");
  return { workbook, sheets, sheetsWithImages };
}

// ---- colours ----------------------------------------------------------------

const DEFAULT_THEME: string[] = [
  "FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72",
];

// Reads the workbook's theme palette (Excel stores "accent 1" etc. as an
// index into it rather than as an RGB value).
function readThemePalette(workbook: ExcelJS.Workbook): string[] {
  const themes = (workbook as unknown as { model?: { themes?: Record<string, string> } }).model?.themes;
  const xml = themes ? Object.values(themes)[0] : undefined;
  if (typeof xml !== "string") return DEFAULT_THEME;
  const scheme = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml)?.[1];
  if (!scheme) return DEFAULT_THEME;
  const read = (tag: string): string | undefined => {
    const block = new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`).exec(scheme)?.[1];
    return block && (/(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"/.exec(block)?.[1] ?? undefined);
  };
  // Excel's theme index order swaps the first two pairs of the file's order.
  const order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return order.map((tag, i) => read(tag) ?? DEFAULT_THEME[i]);
}

function hexToRgb(hex: string): RGB {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function applyTint(rgb: RGB, tint: number): RGB {
  if (!tint) return rgb;
  return rgb.map((c) => Math.round(tint > 0 ? c + (255 - c) * tint : c * (1 + tint))) as RGB;
}

function resolveColor(color: Partial<ExcelJS.Color> | undefined, theme: string[]): RGB | undefined {
  if (!color) return undefined;
  if (color.argb && /^[0-9A-Fa-f]{8}$/.test(color.argb)) return hexToRgb(color.argb.slice(2));
  const withTheme = color as { theme?: number; tint?: number };
  if (typeof withTheme.theme === "number" && theme[withTheme.theme]) {
    return applyTint(hexToRgb(theme[withTheme.theme]), withTheme.tint ?? 0);
  }
  return undefined;
}

// ---- cell text ---------------------------------------------------------------

// jsPDF's built-in fonts cover Latin text only. Typographic punctuation is
// mapped to plain equivalents, and anything outside Latin-1 becomes "?" so the
// PDF never shows garbled glyphs; the count lets us tell the user.
// Keyed by code point rather than written out, so no invisible or look-alike
// characters live in the source.
const PUNCTUATION = new Map<number, string>([
  [0x2013, "-"], // en dash
  [0x2014, "-"], // em dash
  [0x2212, "-"], // minus sign
  [0x2018, "'"], // left single quote
  [0x2019, "'"], // right single quote
  [0x201c, '"'], // left double quote
  [0x201d, '"'], // right double quote
  [0x2026, "..."], // ellipsis
  [0x2022, "*"], // bullet
  [0x00a0, " "], // no-break space
  [0x2122, "TM"], // trade mark
  [0x20ac, "EUR"], // euro
]);

function toPdfSafe(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 0;
    const mapped = PUNCTUATION.get(code);
    if (mapped !== undefined) out += mapped;
    else if (code === 9 || code === 10 || (code >= 32 && code <= 126) || (code >= 161 && code <= 255)) out += ch;
    else if (code < 32) out += " ";
    else {
      out += "?";
      replaced++;
    }
  }
  return { text: out, replaced };
}

// Text that reads as a number (CSV cells arrive as strings): optional sign or
// parentheses, optional dollar/euro/pound sign, digits, optional percent.
const NUMERIC_TEXT = new RegExp(
  String.raw`^\s*[-(]?[$` + String.fromCharCode(0x20ac, 0xa3) + String.raw`]?[\d,]+(\.\d+)?%?\)?\s*$`,
);

interface CellDisplay {
  text: string;
  numeric: boolean;
  kind: "text" | "number" | "boolean" | "error";
}

function displayOf(cell: ExcelJS.Cell, valueType: ExcelJsModule["ValueType"]): CellDisplay {
  const type = cell.type;
  if (type === valueType.Null || type === valueType.Merge) return { text: "", numeric: false, kind: "text" };

  let value: unknown = cell.value;
  if (type === valueType.Formula) value = (cell.value as { result?: unknown }).result;

  if (typeof value === "number") {
    // Normally ExcelJS turns date-formatted numbers into Dates itself; this
    // catches serials it left alone (e.g. the result of a date formula).
    if (isDateFormat(cell.numFmt)) {
      const serial = new Date(Math.round((value - 25569) * 86_400_000));
      return { text: formatDate(serial, cell.numFmt), numeric: true, kind: "number" };
    }
    return { text: formatNumber(value, cell.numFmt), numeric: true, kind: "number" };
  }
  if (value instanceof Date) {
    return { text: formatDate(value, cell.numFmt), numeric: true, kind: "number" };
  }
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", numeric: false, kind: "boolean" };
  if (value && typeof value === "object" && "error" in value) {
    return { text: String((value as { error: unknown }).error), numeric: false, kind: "error" };
  }
  if (typeof value === "string") {
    // CSV-style numeric text still reads (and aligns) as a number.
    return { text: value, numeric: NUMERIC_TEXT.test(value), kind: "text" };
  }
  // Rich text, hyperlinks and everything else: ExcelJS knows how to flatten.
  return { text: cell.text ?? "", numeric: false, kind: "text" };
}

// ---- layout ------------------------------------------------------------------

const PAGE = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] } as const;
const MARGIN = 28;
const FOOTER_HEIGHT = 16;
const CELL_PADDING = 2.5;
const DEFAULT_ROW_HEIGHT = 15;
const DEFAULT_COLUMN_WIDTH_CHARS = 8.43;
const LINE_HEIGHT = 1.18;
// Below this scale, text gets unreadably small, so wide sheets are split
// across pages of columns instead of shrunk further.
const MIN_SCALE = 0.55;

interface BorderSide {
  width: number;
  color: RGB;
  dash: boolean;
}

interface StyledCell {
  row: number;
  column: number;
  display: CellDisplay;
  family: "helvetica" | "times" | "courier";
  style: "normal" | "bold" | "italic" | "bolditalic";
  size: number;
  color: RGB;
  fill?: RGB;
  horizontal: "left" | "center" | "right";
  vertical: "top" | "middle" | "bottom";
  wrap: boolean;
  borders: { top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide };
  colSpan: number;
  rowSpan: number;
}

function fontFamilyOf(name: string | undefined): StyledCell["family"] {
  const n = (name ?? "").toLowerCase();
  if (/courier|consolas|mono|menlo/.test(n)) return "courier";
  if (/times|georgia|serif|cambria|garamond|book/.test(n) && !/sans/.test(n)) return "times";
  return "helvetica";
}

function borderOf(border: Partial<ExcelJS.Border> | undefined, theme: string[]): BorderSide | undefined {
  if (!border?.style) return undefined;
  const width = border.style === "thick" ? 1.6 : border.style === "medium" || border.style === "mediumDashed" ? 1.1 : 0.55;
  return {
    width,
    color: resolveColor(border.color, theme) ?? [0, 0, 0],
    dash: /dash|dot/i.test(border.style),
  };
}

function styleCell(
  cell: ExcelJS.Cell,
  row: number,
  column: number,
  display: CellDisplay,
  span: { colSpan: number; rowSpan: number },
  theme: string[],
): StyledCell {
  const font = cell.font ?? {};
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  const alignment = cell.alignment ?? {};
  const border = cell.border ?? {};

  const bold = !!font.bold;
  const italic = !!font.italic;

  let horizontal: StyledCell["horizontal"];
  switch (alignment.horizontal) {
    case "center":
    case "centerContinuous":
      horizontal = "center";
      break;
    case "right":
      horizontal = "right";
      break;
    case "left":
      horizontal = "left";
      break;
    default:
      // Excel's own defaults: numbers right, booleans/errors centred, text left.
      horizontal = display.kind === "number" ? "right" : display.kind === "boolean" || display.kind === "error" ? "center" : "left";
  }

  return {
    row,
    column,
    display,
    family: fontFamilyOf(font.name),
    style: bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal",
    size: font.size ?? 11,
    color: resolveColor(font.color, theme) ?? [0, 0, 0],
    fill: fill?.type === "pattern" && fill.pattern === "solid" ? resolveColor(fill.fgColor, theme) : undefined,
    horizontal,
    vertical: alignment.vertical === "top" ? "top" : alignment.vertical === "middle" ? "middle" : "bottom",
    wrap: !!alignment.wrapText,
    borders: {
      top: borderOf(border.top, theme),
      right: borderOf(border.right, theme),
      bottom: borderOf(border.bottom, theme),
      left: borderOf(border.left, theme),
    },
    colSpan: span.colSpan,
    rowSpan: span.rowSpan,
  };
}

function columnWidthPt(worksheet: ExcelJS.Worksheet, column: number): number {
  const chars = worksheet.getColumn(column).width ?? worksheet.properties.defaultColWidth ?? DEFAULT_COLUMN_WIDTH_CHARS;
  // Excel: pixels = chars * 7 + 5 at 96 DPI; PDF points = pixels * 0.75.
  return (chars * 7 + 5) * 0.75;
}

interface SheetPlan {
  name: string;
  // Visible columns in order, with their natural width in points.
  columns: { index: number; width: number }[];
  // Visible rows in order, with the height Excel specified (if any).
  rows: { index: number; height: number | undefined }[];
  cells: Map<string, StyledCell>;
  replacedCharacters: number;
}

function keyOf(row: number, column: number): string {
  return `${row}:${column}`;
}

function planSheet(
  worksheet: ExcelJS.Worksheet,
  valueType: ExcelJsModule["ValueType"],
  theme: string[],
): SheetPlan | null {
  const { lastRow, lastColumn } = extractsOf(worksheet);
  if (lastRow === 0 || lastColumn === 0) return null;

  // Merged ranges: the top-left cell draws the whole block; the rest are skipped.
  const master = new Map<string, { colSpan: number; rowSpan: number }>();
  const covered = new Set<string>();
  for (const range of (worksheet.model as { merges?: string[] }).merges ?? []) {
    const [a, b] = range.split(":");
    const start = /^([A-Z]+)(\d+)$/.exec(a);
    const end = b ? /^([A-Z]+)(\d+)$/.exec(b) : null;
    if (!start || !end) continue;
    const r1 = Number(start[2]);
    const c1 = columnLettersToNumber(start[1]);
    const r2 = Number(end[2]);
    const c2 = columnLettersToNumber(end[1]);
    master.set(keyOf(r1, c1), { colSpan: c2 - c1 + 1, rowSpan: r2 - r1 + 1 });
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(keyOf(r, c));
    }
  }

  const columns: SheetPlan["columns"] = [];
  for (let c = 1; c <= lastColumn; c++) {
    if (worksheet.getColumn(c).hidden) continue;
    columns.push({ index: c, width: columnWidthPt(worksheet, c) });
  }
  const rows: SheetPlan["rows"] = [];
  const cells = new Map<string, StyledCell>();
  let replacedCharacters = 0;

  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    if (row.hidden) continue;
    rows.push({ index: r, height: row.height });
    for (const { index: c } of columns) {
      const key = keyOf(r, c);
      if (covered.has(key)) continue;
      const cell = row.getCell(c);
      const display = displayOf(cell, valueType);
      const safe = toPdfSafe(display.text);
      replacedCharacters += safe.replaced;
      display.text = safe.text;
      cells.set(key, styleCell(cell, r, c, display, master.get(key) ?? { colSpan: 1, rowSpan: 1 }, theme));
    }
  }
  return { name: worksheet.name, columns, rows, cells, replacedCharacters };
}

// Greedily packs columns into groups that each fit a page at a readable scale.
function splitColumnGroups(columns: SheetPlan["columns"], usableWidth: number): SheetPlan["columns"][] {
  const total = columns.reduce((sum, c) => sum + c.width, 0);
  if (total * MIN_SCALE <= usableWidth) return [columns];
  const limit = usableWidth / MIN_SCALE;
  const groups: SheetPlan["columns"][] = [];
  let current: SheetPlan["columns"] = [];
  let width = 0;
  for (const column of columns) {
    if (current.length > 0 && width + column.width > limit) {
      groups.push(current);
      current = [];
      width = 0;
    }
    current.push(column);
    width += column.width;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// ---- drawing -----------------------------------------------------------------

function applyFont(doc: jsPDF, cell: StyledCell, scale: number, sizeOverride?: number): number {
  const size = Math.max(3, (sizeOverride ?? cell.size) * scale);
  doc.setFont(cell.family, cell.style);
  doc.setFontSize(size);
  return size;
}

function wrapLines(doc: jsPDF, cell: StyledCell, maxWidth: number, scale: number): string[] {
  applyFont(doc, cell, scale);
  const text = cell.display.text;
  if (text === "") return [];
  if (cell.wrap) return doc.splitTextToSize(text, Math.max(4, maxWidth)) as string[];
  return text.split(/\r?\n/);
}

export async function workbookToPdf(loaded: LoadedWorkbook, options: ExcelToPdfOptions): Promise<ExcelToPdfResult> {
  const [{ jsPDF }, excel] = await Promise.all([import("jspdf"), loadExcelJs()]);
  const theme = readThemePalette(loaded.workbook);
  const warnings: string[] = [];

  const plans: SheetPlan[] = [];
  let totalRows = 0;
  for (const name of options.sheetNames) {
    const worksheet = loaded.workbook.getWorksheet(name);
    if (!worksheet) continue;
    const plan = planSheet(worksheet, excel.ValueType, theme);
    if (!plan) {
      warnings.push(`"${name}" is empty, so it was skipped.`);
      continue;
    }
    totalRows += plan.rows.length;
    if (totalRows > MAX_EXCEL_ROWS) throw new ExcelConvertError("excel_too_many_rows");
    plans.push(plan);
  }
  if (plans.length === 0) throw new ExcelConvertError("excel_no_data");

  const replaced = plans.reduce((sum, plan) => sum + plan.replacedCharacters, 0);
  if (replaced > 0) {
    warnings.push(
      `${replaced} character${replaced === 1 ? "" : "s"} outside the Latin alphabet (for example Chinese, Arabic or emoji) can't be shown and appear as "?".`,
    );
  }
  const imageSheets = loaded.sheetsWithImages.filter((name) => options.sheetNames.includes(name));
  if (imageSheets.length > 0) warnings.push("Pictures aren't included in the PDF.");

  let doc: jsPDF | null = null;
  const pageSheetNames: string[] = [];
  let rowsDone = 0;

  for (const plan of plans) {
    const naturalWidth = plan.columns.reduce((sum, c) => sum + c.width, 0);
    const orientation: "portrait" | "landscape" =
      options.orientation === "auto"
        ? naturalWidth > PAGE.portrait[0] - MARGIN * 2
          ? "landscape"
          : "portrait"
        : options.orientation;
    const [pageWidth, pageHeight] = PAGE[orientation];
    const usableWidth = pageWidth - MARGIN * 2;
    const bottomLimit = pageHeight - MARGIN - FOOTER_HEIGHT;

    const groups = splitColumnGroups(plan.columns, usableWidth);
    if (groups.length > 1) {
      warnings.push(`"${plan.name}" is very wide, so its columns continue on following pages.`);
    }

    for (const group of groups) {
      const groupWidth = group.reduce((sum, c) => sum + c.width, 0);
      const scale = Math.min(1, usableWidth / groupWidth);
      const columnX = new Map<number, number>();
      let cursor = MARGIN;
      for (const column of group) {
        columnX.set(column.index, cursor);
        cursor += column.width * scale;
      }
      const widthOf = new Map(group.map((c) => [c.index, c.width * scale]));

      if (!doc) {
        doc = new jsPDF({ unit: "pt", format: "a4", orientation });
      } else {
        doc.addPage("a4", orientation);
      }
      pageSheetNames.push(plan.name);
      let y = MARGIN;

      // Row heights first (wrapped text can make a row taller than Excel's).
      const heights = new Map<number, number>();
      const linesByCell = new Map<string, string[]>();
      for (const row of plan.rows) {
        let height = (row.height ?? DEFAULT_ROW_HEIGHT) * scale;
        for (const column of group) {
          const cell = plan.cells.get(keyOf(row.index, column.index));
          if (!cell) continue;
          let width = 0;
          for (let i = 0; i < cell.colSpan; i++) width += widthOf.get(column.index + i) ?? 0;
          const lines = wrapLines(doc, cell, width - CELL_PADDING * 2, scale);
          linesByCell.set(keyOf(row.index, column.index), lines);
          if (row.height === undefined && cell.rowSpan === 1 && lines.length > 0) {
            const need = lines.length * cell.size * scale * LINE_HEIGHT + CELL_PADDING * 2;
            height = Math.max(height, need);
          }
        }
        heights.set(row.index, Math.min(height, bottomLimit - MARGIN));
      }

      // Assign each row to a page position.
      const rowIndexes = plan.rows.map((r) => r.index);
      const rowTop = new Map<number, number>();
      const pageBreaksBefore = new Set<number>();
      for (const rowIndex of rowIndexes) {
        const height = heights.get(rowIndex) ?? 0;
        if (y + height > bottomLimit && y > MARGIN) {
          pageBreaksBefore.add(rowIndex);
          y = MARGIN;
        }
        rowTop.set(rowIndex, y);
        y += height;
      }

      let pageRows: number[] = [];
      const flushPage = (isLast: boolean) => {
        if (!doc) return;
        drawRows(doc, plan, group, pageRows, { columnX, widthOf, heights, rowTop, linesByCell, scale, showGridlines: options.showGridlines });
        pageRows = [];
        if (!isLast) {
          doc.addPage("a4", orientation);
          pageSheetNames.push(plan.name);
        }
      };
      for (const rowIndex of rowIndexes) {
        if (pageBreaksBefore.has(rowIndex)) flushPage(false);
        pageRows.push(rowIndex);
        rowsDone++;
        if (rowsDone % 200 === 0) {
          options.onProgress?.(Math.min(0.95, rowsDone / totalRows));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      flushPage(true);
    }
  }

  if (!doc) throw new ExcelConvertError("excel_no_data");

  // Footer once the total is known: sheet name on the left, "Page x of y" right.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    const [w, h] = [doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight()];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(130, 130, 130);
    doc.text(toPdfSafe(pageSheetNames[page - 1] ?? "").text, MARGIN, h - MARGIN + 4, { baseline: "top" });
    doc.text(`Page ${page} of ${pageCount}`, w - MARGIN, h - MARGIN + 4, { align: "right", baseline: "top" });
  }

  options.onProgress?.(1);
  return { blob: doc.output("blob"), pageCount, warnings };
}

interface DrawContext {
  columnX: Map<number, number>;
  widthOf: Map<number, number>;
  heights: Map<number, number>;
  rowTop: Map<number, number>;
  linesByCell: Map<string, string[]>;
  scale: number;
  showGridlines: boolean;
}

function drawRows(
  doc: jsPDF,
  plan: SheetPlan,
  group: SheetPlan["columns"],
  rowsOnPage: number[],
  ctx: DrawContext,
): void {
  const onPage = new Set(rowsOnPage);
  const spanHeight = (cell: StyledCell): number => {
    let total = 0;
    for (let i = 0; i < cell.rowSpan; i++) {
      const rowIndex = cell.row + i;
      if (onPage.has(rowIndex)) total += ctx.heights.get(rowIndex) ?? 0;
    }
    return total;
  };
  const spanWidth = (cell: StyledCell): number => {
    let total = 0;
    for (let i = 0; i < cell.colSpan; i++) total += ctx.widthOf.get(cell.column + i) ?? 0;
    return total;
  };

  const cellsInOrder: { cell: StyledCell; x: number; y: number; w: number; h: number }[] = [];
  for (const rowIndex of rowsOnPage) {
    for (const column of group) {
      const cell = plan.cells.get(keyOf(rowIndex, column.index));
      if (!cell) continue;
      const w = spanWidth(cell);
      const h = spanHeight(cell);
      if (w <= 0 || h <= 0) continue;
      cellsInOrder.push({ cell, x: ctx.columnX.get(column.index) ?? MARGIN, y: ctx.rowTop.get(rowIndex) ?? MARGIN, w, h });
    }
  }

  // Fills, then grid + borders, then text, so nothing paints over text.
  for (const { cell, x, y, w, h } of cellsInOrder) {
    if (cell.fill) {
      doc.setFillColor(...cell.fill);
      doc.rect(x, y, w, h, "F");
    }
  }
  if (ctx.showGridlines) {
    doc.setDrawColor(208, 208, 208);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([], 0);
    for (const { x, y, w, h } of cellsInOrder) doc.rect(x, y, w, h, "S");
  }
  for (const { cell, x, y, w, h } of cellsInOrder) {
    const sides: [BorderSide | undefined, number, number, number, number][] = [
      [cell.borders.top, x, y, x + w, y],
      [cell.borders.right, x + w, y, x + w, y + h],
      [cell.borders.bottom, x, y + h, x + w, y + h],
      [cell.borders.left, x, y, x, y + h],
    ];
    for (const [side, x1, y1, x2, y2] of sides) {
      if (!side) continue;
      doc.setDrawColor(...side.color);
      doc.setLineWidth(side.width * Math.max(ctx.scale, 0.7));
      doc.setLineDashPattern(side.dash ? [2, 1.5] : [], 0);
      doc.line(x1, y1, x2, y2);
    }
    doc.setLineDashPattern([], 0);
  }

  const columnPosition = new Map(group.map((column, position) => [column.index, position]));
  // Like Excel, left-aligned text that doesn't wrap may run across the empty
  // cells to its right instead of being cut off at its own column edge.
  const spillWidth = (cell: StyledCell): number => {
    if (cell.wrap || cell.horizontal !== "left" || cell.display.kind !== "text" || cell.colSpan > 1) return 0;
    let extra = 0;
    for (let position = (columnPosition.get(cell.column) ?? 0) + 1; position < group.length; position++) {
      const next = plan.cells.get(keyOf(cell.row, group[position].index));
      if (!next || next.display.text !== "" || next.fill) break;
      extra += ctx.widthOf.get(group[position].index) ?? 0;
    }
    return extra;
  };

  for (const { cell, x, y, w, h } of cellsInOrder) {
    const lines = ctx.linesByCell.get(keyOf(cell.row, cell.column)) ?? [];
    if (lines.length === 0) continue;

    let fontSize = applyFont(doc, cell, ctx.scale);
    const available = w + spillWidth(cell) - CELL_PADDING * 2;
    let drawn = lines;
    if (!cell.wrap) {
      const widest = Math.max(...lines.map((line) => doc.getTextWidth(line)));
      if (widest > available) {
        if (cell.display.kind === "number") {
          // Never cut digits off a number: shrink it to fit instead.
          fontSize = Math.max(4, fontSize * (available / widest) * 0.98);
          doc.setFontSize(fontSize);
        } else {
          drawn = lines.map((line) => {
            let text = line;
            while (text.length > 1 && doc.getTextWidth(text) > available) text = text.slice(0, -1);
            return text;
          });
        }
      }
    }

    const lineHeight = fontSize * LINE_HEIGHT;
    const blockHeight = drawn.length * lineHeight;
    const top =
      cell.vertical === "top"
        ? y + CELL_PADDING
        : cell.vertical === "middle"
          ? y + (h - blockHeight) / 2
          : y + h - CELL_PADDING - blockHeight;

    doc.setTextColor(...cell.color);
    const textX = cell.horizontal === "left" ? x + CELL_PADDING : cell.horizontal === "right" ? x + w - CELL_PADDING : x + w / 2;
    drawn.forEach((line, i) => {
      const lineY = top + i * lineHeight;
      // Skip lines that would spill past the cell's own bottom edge.
      if (lineY + lineHeight * 0.5 > y + h + 0.5) return;
      doc.text(line, textX, lineY, { align: cell.horizontal, baseline: "top" });
    });
  }
}
