"use client";

// PDF -> Excel, entirely in the browser.
//
// Digital PDFs (real, selectable text): PDF.js reports every string with its
// position, and tableExtract.ts rebuilds rows and columns from the geometry.
//
// Scanned PDFs (pages that are just pictures): read with the same free
// in-browser OCR used for "Extract text", and written one line per row. Column
// detection from OCR word positions is the reserved Premium
// `ocr.table_extraction` feature (see utils/features/plans.ts), so it is
// deliberately not done here.

import type { Worksheet } from "exceljs";
import { getOcrLimits } from "@/utils/ocr/config";
import { runOcr } from "@/utils/ocr/run";
import type { PlanId } from "@/utils/features/plans";
import { openPdf, PdfError } from "@/utils/pdf/pdfjs";
import { renderPdfPage } from "@/utils/pdf/render";
import { createInitialPage, type ScannerPage } from "@/utils/scanner/page";
import { loadExcelJs } from "./loadExcelJs";
import { extractTable, parseCellValue, type PositionedText } from "./tableExtract";

export const MAX_PDF_TO_EXCEL_PAGES = 100;

// A page with fewer text characters than this is treated as a scan (a real
// page of content has far more; a few stray characters are usually a page
// number sitting over an image).
const MIN_TEXT_CHARS = 8;
// A page whose extracted content is a single line is *also* treated as a
// scan candidate even if MIN_TEXT_CHARS is met -- a stamped page number,
// footer, or watermark on an otherwise-scanned page is almost always exactly
// one short line, while genuine content (even a short table) is virtually
// always more than one line. Character count alone isn't enough to trust a
// page as "real" digital text.
const MIN_DIGITAL_ROWS = 2;
// Scans are read at this size; matches what the OCR engine is tuned for.
const OCR_RENDER_LONG_SIDE_PX = 2000;
const PREVIEW_ROWS = 12;
const PREVIEW_COLUMNS = 8;

export type PdfToExcelLayout = "sheet-per-page" | "single-sheet";

export type PdfToExcelProgress =
  | { phase: "reading"; page: number; pageCount: number }
  | { phase: "ocr"; page: number; pageCount: number; fraction: number };

export interface PdfToExcelOptions {
  layout: PdfToExcelLayout;
  plan: PlanId;
  // Whether scanned pages may be read with OCR.
  ocrEnabled: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: PdfToExcelProgress) => void;
}

export interface PdfToExcelResult {
  blob: Blob;
  pageCount: number;
  sheetCount: number;
  rowCount: number;
  // 1-based page numbers, for telling the user exactly what happened.
  digitalPages: number[];
  ocrPages: number[];
  // Pages with no text that OCR wasn't run on (turned off, over the limit, or
  // nothing readable), so they're not in the workbook.
  unreadPages: number[];
  // The top-left of the first sheet with data, for an on-screen preview.
  preview: string[][];
}

interface PageExtract {
  pageNumber: number;
  rows: string[][];
  source: "digital" | "ocr" | "unread";
  // Rendered image of a scanned page, held only until OCR has read it.
  scanned?: ScannerPage;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function textRichness(rows: string[][]): number {
  return rows.reduce((sum, row) => sum + row.reduce((rowSum, cell) => rowSum + cell.length, 0), 0);
}

async function readPages(file: File, options: PdfToExcelOptions): Promise<PageExtract[]> {
  const { doc, destroy } = await openPdf(file, { maxPages: MAX_PDF_TO_EXCEL_PAGES });
  const limits = getOcrLimits(options.plan);
  const extracts: PageExtract[] = [];
  let ocrCandidates = 0;

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      options.onProgress?.({ phase: "reading", page: pageNumber, pageCount: doc.numPages });

      const page = await doc.getPage(pageNumber);
      try {
        // getViewport() defaults `rotation` to the page's own /Rotate, so
        // viewport.width/height already reflect it -- but item.transform's
        // x/y are always in unrotated PDF user space. Project every item
        // through the same viewport transform so coordinates and pageWidth
        // agree for rotated (e.g. landscape-exported) pages, and swap
        // width/height for 90/270deg pages since what was horizontal extent
        // in unrotated glyph space becomes vertical extent once displayed.
        const viewport = page.getViewport({ scale: 1 });
        const rotated90 = Math.abs(viewport.rotation % 180) === 90;
        const content = await page.getTextContent();
        const items: PositionedText[] = [];
        let characters = 0;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          characters += item.str.trim().length;
          const [vx, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          // Viewport space grows downward; flip back to the "grows upward"
          // convention tableExtract.ts's row/column geometry already assumes.
          items.push({
            str: item.str,
            x: vx,
            y: -vy,
            width: rotated90 ? item.height || 10 : item.width,
            height: (rotated90 ? item.width : item.height) || Math.abs(item.transform[3]) || 10,
          });
        }

        const digitalRows = items.length > 0 ? extractTable(items, viewport.width) : [];
        const nonEmptyRows = digitalRows.filter((row) => row.length > 0).length;
        const looksDigital = characters >= MIN_TEXT_CHARS && nonEmptyRows >= MIN_DIGITAL_ROWS;

        if (looksDigital) {
          extracts.push({ pageNumber, rows: digitalRows, source: "digital" });
          continue;
        }

        // Weak or absent digital text (or a sparse stamp/watermark over what
        // is really a scanned page) -- try OCR too, and keep whichever
        // result actually has more content once both are known (see
        // readScannedPages). Keep the digital rows as the fallback in case
        // OCR is disabled, over the per-run page limit, or genuinely adds
        // nothing (e.g. a short but real one-line digital page).
        const extract: PageExtract = { pageNumber, rows: digitalRows, source: digitalRows.length > 0 ? "digital" : "unread" };
        // Only render (and later OCR) as many scans as one OCR run allows.
        if (options.ocrEnabled && ocrCandidates < limits.maxPagesPerRun) {
          ocrCandidates++;
          const rendered = await renderPdfPage(page, OCR_RENDER_LONG_SIDE_PX);
          extract.scanned = createInitialPage(
            { id: crypto.randomUUID(), ...rendered },
            { skipDetection: true },
          );
        }
        extracts.push(extract);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await destroy();
  }
  return extracts;
}

// One OCR run for all scanned pages, so the engine loads once.
async function readScannedPages(extracts: PageExtract[], options: PdfToExcelOptions): Promise<void> {
  const targets = extracts.filter((e) => e.scanned);
  if (targets.length === 0) return;
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

  const { result } = await runOcr({
    targets: targets.map((e) => ({ page: e.scanned as ScannerPage, pageNumber: e.pageNumber })),
    scope: "document",
    limits: getOcrLimits(options.plan),
    signal: options.signal,
    onProgress: (progress) => {
      options.onProgress?.({
        phase: "ocr",
        page: targets[Math.min(progress.pageIndex, targets.length - 1)].pageNumber,
        pageCount: targets.length,
        fraction: progress.phase === "loading_engine" ? 0 : (progress.pageIndex + progress.fraction) / progress.pageCount,
      });
    },
  });

  for (const read of result.pages) {
    const extract = targets.find((e) => e.pageNumber === read.pageNumber);
    if (!extract) continue;
    // One line of text per row: plain and reliable, no guessed columns.
    const ocrRows = read.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => [line]);
    // The page may already carry a (possibly sparse/stray) digital
    // extraction -- keep whichever actually has more content rather than
    // always preferring OCR, so a short-but-real digital page isn't
    // discarded just because it also happened to queue for OCR.
    if (textRichness(ocrRows) > textRichness(extract.rows)) {
      extract.rows = ocrRows;
      extract.source = "ocr";
    }
  }
  // Release the rendered images.
  for (const extract of targets) extract.scanned = undefined;
}

// Exported so utils/convert/ocrToXlsx.ts (the scanner's standalone OCR-only
// XLSX export) can reuse the exact same row-writing/cell-typing logic.
export function writeRows(worksheet: Worksheet, rows: string[][]): void {
  const widths: number[] = [];
  // When the page has a table, single-cell rows are titles and notes that
  // overflow into the empty cells beside them, so they shouldn't make the
  // first column absurdly wide.
  const hasTable = rows.some((row) => row.length > 1);
  for (const row of rows) {
    const excelRow = worksheet.addRow([]);
    const countsForWidth = !hasTable || row.length > 1;
    row.forEach((text, columnIndex) => {
      if (countsForWidth) widths[columnIndex] = Math.max(widths[columnIndex] ?? 0, Math.min(60, text.length));
      if (text === "") return;
      const typed = parseCellValue(text);
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = typed.value;
      if (typed.numFmt) cell.numFmt = typed.numFmt;
    });
  }
  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = Math.max(8, width + 2);
  });
}

export async function convertPdfToExcel(file: File, options: PdfToExcelOptions): Promise<PdfToExcelResult> {
  const extracts = await readPages(file, options);
  await readScannedPages(extracts, options);

  const withRows = extracts.filter((e) => e.rows.length > 0);
  if (withRows.length === 0) throw new PdfError("pdf_no_text");

  const { Workbook } = await loadExcelJs();
  const workbook = new Workbook();
  workbook.creator = "PDFScanner";

  let sheetCount = 0;
  if (options.layout === "single-sheet") {
    writeRows(workbook.addWorksheet("All pages"), withRows.flatMap((e) => e.rows));
    sheetCount = 1;
  } else {
    for (const extract of withRows) {
      writeRows(workbook.addWorksheet(`Page ${extract.pageNumber}`), extract.rows);
      sheetCount++;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: XLSX_MIME }),
    pageCount: extracts.length,
    sheetCount,
    rowCount: withRows.reduce((sum, e) => sum + e.rows.length, 0),
    digitalPages: extracts.filter((e) => e.source === "digital" && e.rows.length > 0).map((e) => e.pageNumber),
    ocrPages: extracts.filter((e) => e.source === "ocr").map((e) => e.pageNumber),
    unreadPages: extracts.filter((e) => e.rows.length === 0).map((e) => e.pageNumber),
    preview: withRows[0].rows
      .slice(0, PREVIEW_ROWS)
      .map((row) => Array.from({ length: Math.min(PREVIEW_COLUMNS, row.length) }, (_, i) => row[i] ?? "")),
  };
}
