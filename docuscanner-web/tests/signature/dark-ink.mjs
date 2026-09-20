// Reports dark ink below the page title on an exported PDF page (proves a drawn signature is in the file).
import { renderPdf } from "../docx/pdftool.mjs";
import fs from "node:fs";
const [p] = await renderPdf(process.argv[2], "tests/docx/out/_ink", 1.5);
const { width: w, height: h } = p.canvas;
const d = p.canvas.getContext("2d").getImageData(0, 0, w, h).data;
let n = 0, minX = w, minY = h, maxX = 0, maxY = 0;
for (let y = Math.floor(h * 0.15); y < h; y++) for (let x = 0; x < w; x++) { const j = (y * w + x) * 4; if (d[j] < 90 && d[j + 1] < 90 && d[j + 2] < 120) { n++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } }
console.log(`dark signature ink px: ${n}` + (n ? `; box x ${(minX / w * 100).toFixed(0)}-${(maxX / w * 100).toFixed(0)}%, y ${(minY / h * 100).toFixed(0)}-${(maxY / h * 100).toFixed(0)}%` : ""));
for (const f of fs.readdirSync("tests/docx/out")) if (f.startsWith("_ink")) fs.unlinkSync("tests/docx/out/" + f);
