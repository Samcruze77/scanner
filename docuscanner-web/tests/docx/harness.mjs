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

export async function convertFile(docxPath, extra = {}) {
  const data = new Uint8Array(fs.readFileSync(docxPath));
  return engine.docxToPdf(data, { loadFont, title: path.basename(docxPath), ...extra });
}

export { require };
