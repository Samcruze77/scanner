// Rows -> a genuine RFC 4180 CSV string. Dependency-free, same "small and
// easy to reason about" philosophy as tableExtract.ts. A field is quoted
// whenever it contains a comma, a quote, or a newline; an internal quote is
// escaped by doubling it, per the spec.

function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

// One line per row, same shape OCR text naturally comes in (see
// ocrToXlsx.ts's rowsFromOcrText) -- each line becomes a single-column CSV
// row, consistent with the "no guessed columns" rule used for scanned pages
// everywhere else in the app.
export function ocrTextToCsv(text: string): string {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => [line]);
  return rowsToCsv(rows);
}
