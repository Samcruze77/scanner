// Copies the self-hosted PDF.js runtime (worker, CMaps, standard fonts, WASM
// image decoders) from node_modules into public/pdfjs/ so the browser loads
// them same-origin instead of from a third-party CDN. Runs automatically
// before `dev` and `build` (see package.json).
//
// The "legacy" build is used on purpose: it works on older mobile browsers
// (e.g. Safari before 17.4) that lack APIs the modern build relies on.

import { cpSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "pdfjs");
const pkg = join(root, "node_modules", "pdfjs-dist");

const FILES = [
  ["legacy/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["LICENSE", "LICENSE"],
];
const DIRS = [
  // Needed to decode CJK / non-embedded-encoding PDFs.
  ["cmaps", "cmaps"],
  // Metric-compatible fallbacks for PDFs that don't embed the base-14 fonts.
  ["standard_fonts", "standard_fonts"],
  // JPEG2000 / JBIG2 decoders, common in scanned PDFs.
  ["wasm", "wasm"],
];

if (!existsSync(pkg)) {
  console.error('[copy-pdf-assets] Missing node_modules/pdfjs-dist. Run "npm install" first.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const [from, to] of FILES) {
  const dest = join(outDir, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(pkg, from), dest);
}
for (const [from, to] of DIRS) {
  cpSync(join(pkg, from), join(outDir, to), { recursive: true });
}

console.log("[copy-pdf-assets] Copied PDF.js runtime to public/pdfjs/");
