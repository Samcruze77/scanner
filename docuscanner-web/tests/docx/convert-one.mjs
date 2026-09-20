// Converts one DOCX and renders our PDF to PNGs: node tests/docx/convert-one.mjs <file.docx> [scale]
import fs from "node:fs";
import path from "node:path";
import { convertFile, outDir } from "./harness.mjs";
import { renderPdf } from "./pdftool.mjs";
const file = process.argv[2];
const t0 = Date.now();
const result = await convertFile(file);
const base = path.basename(file, ".docx");
const pdf = path.join(outDir, `${base}.pdf`);
fs.writeFileSync(pdf, result.bytes);
console.log(`${base}: ${result.pageCount} pages, ${(result.bytes.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms`);
for (const w of result.warnings) console.log("  warn:", w);
const pages = await renderPdf(pdf, path.join(outDir, base), Number(process.argv[3] ?? 0.9));
console.log(pages.map((p) => path.basename(p.out)).join(" "));
