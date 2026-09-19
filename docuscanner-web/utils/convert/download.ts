"use client";

// Everything here runs locally; converted files are never uploaded.

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// "Q3 report.xlsx" -> "Q3 report.pdf". Strips characters that are awkward in
// filenames, and falls back to a generic name so the download always has one.
export function outputFilename(inputName: string, extension: string): string {
  const base = inputName
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\- .()]+/g, "_")
    .trim();
  return `${base || "converted"}.${extension}`;
}
