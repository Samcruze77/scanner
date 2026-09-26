// Shared Node harness for the DOCX -> PDF tests: an XML parser polyfill, a font
// loader that reads the same files the app ships, and the converter itself.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";

globalThis.DOMParser = DOMParser;

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../..");
export const fixtures = path.join(here, "fixtures");
export const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });

const fontsourceDir = path.join(root, "node_modules", "@fontsource");

export async function loadFont(family, subset, bold, italic) {
  const file = path.join(fontsourceDir, family, "files", `${family}-${subset}-${bold ? 700 : 400}-${italic ? "italic" : "normal"}.woff`);
  if (!fs.existsSync(file)) return null;
  return new Uint8Array(fs.readFileSync(file));
}

const engine = await import("../../utils/convert/docx/index.ts");

// Real font files for fonts with no bundled twin (Aptos, Verdana ...), from the
// DOCX_FONT_FILES environment variable (paths separated by ";"). Lets the
// comparison against Word's own PDF run with the real font, e.g.
//   DOCX_FONT_FILES="C:/Windows/Fonts/verdana.ttf;C:/Windows/Fonts/verdanab.ttf" node tests/docx/compare.mjs --dir real
const envFonts = (process.env.DOCX_FONT_FILES ?? "")
  .split(";")
  .filter(Boolean)
  .map((p) => new Uint8Array(fs.readFileSync(p)));

// A fixture can name the real font files it needs in "<name>.fonts.json" (a list
// of paths; "%WINDIR%" expands to the Windows folder). Files that aren't on this
// machine are reported in `missing` so the comparison can be skipped, not faked.
export function sidecarFonts(docxPath) {
  const base = path.basename(docxPath).replace(/(\.word)?\.docx$/, "");
  const file = path.join(path.dirname(docxPath), base + ".fonts.json");
  if (!fs.existsSync(file)) return { files: [], missing: [] };
  const paths = JSON.parse(fs.readFileSync(file, "utf8")).map((p) => p.replace("%WINDIR%", process.env.WINDIR ?? "C:/Windows"));
  const missing = paths.filter((p) => !fs.existsSync(p));
  return { files: missing.length ? [] : paths.map((p) => new Uint8Array(fs.readFileSync(p))), missing };
}

export async function convertFile(docxPath, extra = {}) {
  const data = new Uint8Array(fs.readFileSync(docxPath));
  const fontFiles = [...envFonts, ...sidecarFonts(docxPath).files];
  return engine.docxToPdf(data, { loadFont, title: path.basename(docxPath), fontFiles, ...extra });
}

export { require };
