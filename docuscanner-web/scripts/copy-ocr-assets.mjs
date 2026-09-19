// Copies the self-hosted OCR runtime (worker, WASM core, English model) from
// node_modules into public/ocr/ so the browser loads them same-origin instead
// of from a third-party CDN. Runs automatically before `dev` and `build`
// (see package.json). Only the LSTM core variants are copied -- the legacy
// engine is not used -- and a given device downloads just one of the three.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "ocr");

const ASSETS = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "lang/eng.traineddata.gz"],
  ["node_modules/tesseract.js/LICENSE.md", "licenses/tesseract.js.LICENSE.md"],
  ["node_modules/tesseract.js-core/LICENSE", "licenses/tesseract.js-core.LICENSE"],
];

for (const [from, to] of ASSETS) {
  const src = join(root, from);
  const dest = join(outDir, to);
  if (!existsSync(src)) {
    console.error(`[copy-ocr-assets] Missing ${from}. Run "npm install" first.`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

console.log(`[copy-ocr-assets] Copied ${ASSETS.length} OCR assets to public/ocr/`);
