// Copies the QPDF WebAssembly engine used by Protect PDF from node_modules into
// public/qpdf/, so the browser loads it from this site (same-origin) rather than a
// third-party CDN. Runs automatically before `dev` and `build` (see package.json).

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "qpdf");
const pkg = join(root, "node_modules", "@neslinesli93", "qpdf-wasm");

if (!existsSync(pkg)) {
  console.error('[copy-qpdf-assets] Missing node_modules/@neslinesli93/qpdf-wasm. Run "npm install" first.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(join(pkg, "dist", "qpdf.wasm"), join(outDir, "qpdf.wasm"));
console.log("[copy-qpdf-assets] Copied the QPDF engine to public/qpdf/");
