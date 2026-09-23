"use client";

// Builds an Excel (.xlsx) workbook straight from OCR'd page text -- one line
// per row, same honest limitation as PDF -> Excel's own scanned-page path
// (see that file's header comment): column detection from OCR word
// positions is a reserved Premium feature, deliberately not done here.
// Shared by the scanner's multi-format export; reuses PDF -> Excel's
// writeRows() so both places write/type cells identically.

import { loadExcelJs } from "./loadExcelJs";
import { writeRows } from "./pdfToExcel";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface OcrXlsxPage {
  pageNumber: number;
  text: string;
}

export type OcrXlsxLayout = "sheet-per-page" | "single-sheet";

function rowsFromOcrText(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => [line]);
}

export async function buildXlsxFromOcrPages(pages: OcrXlsxPage[], layout: OcrXlsxLayout): Promise<Blob> {
  const { Workbook } = await loadExcelJs();
  const workbook = new Workbook();
  workbook.creator = "PDFScanner";

  if (layout === "single-sheet") {
    writeRows(workbook.addWorksheet("All pages"), pages.flatMap((p) => rowsFromOcrText(p.text)));
  } else {
    for (const page of pages) {
      writeRows(workbook.addWorksheet(`Page ${page.pageNumber}`), rowsFromOcrText(page.text));
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}
