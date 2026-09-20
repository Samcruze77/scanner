// Renders two PDFs and reports where their pages differ (bounding box, pixel count,
// darkness of the differing pixels). Used to prove annotations/signatures were
// flattened into an exported PDF: node tests/pdf-diff.mjs <original.pdf> <exported.pdf> [page]
import { renderPdf } from "./docx/pdftool.mjs";
import fs from "node:fs";
const [a, b, pageArg, pageArgB] = process.argv.slice(2);
const page = Number(pageArg ?? 1) - 1;
const pageB = Number(pageArgB ?? pageArg ?? 1) - 1;
const A = await renderPdf(a, "tests/docx/out/_diff_a", 1.5);
const B = await renderPdf(b, "tests/docx/out/_diff_b", 1.5);
console.log(`pages: original ${A.length}, exported ${B.length}`);
const ca = A[page].canvas, cb = B[pageB].canvas;
console.log(`original page ${page + 1} vs exported page ${pageB + 1}; size: ${ca.width}x${ca.height} vs ${cb.width}x${cb.height}`);
const w = Math.min(ca.width, cb.width), h = Math.min(ca.height, cb.height);
const da = ca.getContext("2d").getImageData(0, 0, w, h).data, db = cb.getContext("2d").getImageData(0, 0, w, h).data;
let n = 0, minX = w, minY = h, maxX = 0, maxY = 0, dark = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4;
  const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
  // Ignore JPEG noise: only count clear differences where the export is darker.
  if (d > 150 && (db[i] + db[i + 1] + db[i + 2]) < (da[i] + da[i + 1] + da[i + 2]) - 150) { n++; if (db[i] < 100) dark++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
}
console.log(`differing (darker) pixels: ${n}, of which dark ink: ${dark}`);
if (n) console.log(`bounding box: x ${(minX / w * 100).toFixed(0)}%-${(maxX / w * 100).toFixed(0)}%, y ${(minY / h * 100).toFixed(0)}%-${(maxY / h * 100).toFixed(0)}% of the page`);
// Ink that appeared on a blank part of the original (JPEG noise around existing text can't do this).
let added = 0, aminX = w, aminY = h, amaxX = 0, amaxY = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4;
  const blank = da[i] > 245 && da[i + 1] > 245 && da[i + 2] > 245;
  // The neighbourhood must be blank too, so anti-aliased text edges are excluded.
  let nearText = false;
  for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = (yy * w + xx) * 4; if (da[j] < 200) nearText = true; }
  if (blank && !nearText && db[i] < 90 && db[i + 1] < 90 && db[i + 2] < 90) { added++; aminX = Math.min(aminX, x); aminY = Math.min(aminY, y); amaxX = Math.max(amaxX, x); amaxY = Math.max(amaxY, y); }
}
console.log(`ink added on blank areas: ${added} px` + (added ? `, box x ${(aminX / w * 100).toFixed(0)}%-${(amaxX / w * 100).toFixed(0)}%, y ${(aminY / h * 100).toFixed(0)}%-${(amaxY / h * 100).toFixed(0)}%` : ""));
for (const f of fs.readdirSync("tests/docx/out")) if (f.startsWith("_diff_")) fs.unlinkSync("tests/docx/out/" + f);
