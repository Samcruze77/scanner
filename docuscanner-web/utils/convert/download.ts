"use client";

// Everything here runs locally; files are never uploaded.
//
// Saves a Blob to the user's device as a file download, rather than letting the
// browser show it in a tab. Two details matter, both learned from browsers
// that otherwise open PDFs (and text) inline instead of saving them:
//
//  - The blob is re-typed as generic binary. A blob typed `application/pdf`
//    invites the browser to render it in its viewer even with a `download`
//    attribute (iOS Safari and various in-app/Android browsers do). The
//    filename's extension still makes it open as a PDF once saved.
//  - The temporary URL is revoked late. Revoking right after `click()` can
//    cancel the download in Safari before it has started.

const REVOKE_DELAY_MS = 30_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const file = new Blob([blob], { type: "application/octet-stream" });
  const url = URL.createObjectURL(file);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
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
