"use client";

// ExcelJS is large, so it is only loaded when a spreadsheet tool is actually
// used. Shared by Excel -> PDF and PDF -> Excel.

export type ExcelJsModule = typeof import("exceljs");

export async function loadExcelJs(): Promise<ExcelJsModule> {
  const mod = await import("exceljs");
  // The browser bundle is CommonJS, so the library may be on `.default`.
  return "Workbook" in mod ? mod : (mod as unknown as { default: ExcelJsModule }).default;
}
