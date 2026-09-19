// Decides what kind of document a file is, so the main upload can send each one
// down the right path (photos and PDFs are opened as pages; Word, Excel and CSV
// are converted to PDF first). Extension first, because browsers report wildly
// different MIME types for Office files; MIME as a fallback.

export type DocumentKind = "image" | "pdf" | "docx" | "spreadsheet" | "csv" | "legacy-word" | "legacy-excel" | "unknown";

export function classifyDocument(file: File): DocumentKind {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return "spreadsheet";
  if (name.endsWith(".csv") || type === "text/csv") return "csv";
  // Old binary Office formats: recognised so we can explain, not converted.
  if (name.endsWith(".doc")) return "legacy-word";
  if (name.endsWith(".xls")) return "legacy-excel";
  if (type.startsWith("image/")) return "image";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "spreadsheet";
  return "unknown";
}

// For the file picker's `accept`. Extensions are listed as well as MIME types
// because some platforms (notably mobile browsers) only honour one or the other.
export const DOCUMENT_ACCEPT = [
  "image/*",
  "application/pdf",
  ".pdf",
  ".docx",
  ".xlsx",
  ".csv",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

// The short list shown next to every upload button. The bullet is a code point
// so no look-alike characters live in the source.
const DOT = ` ${String.fromCharCode(0x2022)} `;
export const SUPPORTED_FORMATS = ["PDF", "Word", "Excel", "CSV", "Image"].join(DOT);
export const SUPPORTED_FORMATS_DETAIL = "PDF, Word (.docx), Excel (.xlsx), CSV and images (JPG, PNG and more)";
