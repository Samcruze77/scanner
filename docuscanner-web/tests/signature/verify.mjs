// Verifies an exported PDF has a transparent-PNG signature flattened onto a coloured
// page: blue ink exists, and the area around the strokes is still the page's
// yellow (a transparent PNG must not leave a white box).
import { renderPdf } from "../docx/pdftool.mjs";
import fs from "node:fs";
const [file] = process.argv.slice(2);
const [p] = await renderPdf(file, "tests/docx/out/_sig", 1.5);
const { width: w, height: h } = p.canvas;
const d = p.canvas.getContext("2d").getImageData(0, 0, w, h).data;
let blue = 0, white = 0, yellow = 0, minX = w, minY = h, maxX = 0, maxY = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const j = (y * w + x) * 4, r = d[j], g = d[j + 1], b = d[j + 2];
  if (b > 100 && r < 90 && g < 110) { blue++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
}
// Sample the signature's bounding box for background colours.
for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
  const j = (y * w + x) * 4, r = d[j], g = d[j + 1], b = d[j + 2];
  if (r > 245 && g > 245 && b > 245) white++; else if (r > 240 && g > 210 && b < 190) yellow++;
}
console.log(`blue signature ink px: ${blue}; box x ${(minX / w * 100).toFixed(0)}-${(maxX / w * 100).toFixed(0)}%, y ${(minY / h * 100).toFixed(0)}-${(maxY / h * 100).toFixed(0)}%`);
console.log(`inside the signature box: page-yellow px ${yellow}, white px ${white}  -> ${white < yellow * 0.02 ? "TRANSPARENT (no white box)" : "WHITE BOX PRESENT"}`);
for (const f of fs.readdirSync("tests/docx/out")) if (f.startsWith("_sig")) fs.unlinkSync("tests/docx/out/" + f);
