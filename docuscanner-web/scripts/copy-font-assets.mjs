// Copies the open, metric-compatible fonts used by the Word -> PDF converter
// from node_modules/@fontsource into public/fonts/docx/, so the browser loads
// them same-origin (no third-party font CDN) and only when a Word file is
// converted. Runs automatically before `dev` and `build` (see package.json).
//
// Fonts (all SIL Open Font License 1.1, licences copied alongside):
//   Carlito  = metric twin of Calibri        Caladea = metric twin of Cambria
//   Arimo    = metric twin of Arial          Tinos   = metric twin of Times New Roman
//   Cousine  = metric twin of Courier New
// WOFF (not WOFF2) on purpose: the PDF writer can only subset WOFF/TTF.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "fonts", "docx");

const FAMILIES = ["carlito", "caladea", "arimo", "tinos", "cousine"];
// Keep in step with FAMILY_SUBSETS in utils/convert/docx/fonts.ts.
const SUBSETS = ["latin", "latin-ext", "cyrillic", "greek"];

mkdirSync(join(outDir, "licenses"), { recursive: true });

let copied = 0;
for (const family of FAMILIES) {
  const pkg = join(root, "node_modules", "@fontsource", family);
  if (!existsSync(pkg)) {
    console.error(`[copy-font-assets] Missing @fontsource/${family}. Run "npm install" first.`);
    process.exit(1);
  }
  const files = join(pkg, "files");
  for (const name of readdirSync(files)) {
    // e.g. carlito-latin-ext-400-italic.woff
    const m = new RegExp(String.raw`^${family}-([a-z-]+)-(400|700)-(normal|italic)\.woff$`).exec(name);
    if (!m || !SUBSETS.includes(m[1])) continue;
    copyFileSync(join(files, name), join(outDir, name));
    copied += 1;
  }
  copyFileSync(join(pkg, "LICENSE"), join(outDir, "licenses", `${family}-LICENSE.txt`));
}

console.log(`[copy-font-assets] Copied ${copied} font files to public/fonts/docx/`);
