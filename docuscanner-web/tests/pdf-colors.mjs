// Counts characteristic annotation colours per page of an exported PDF.
import { renderPdf } from "./docx/pdftool.mjs";
import fs from "node:fs";
const [file] = process.argv.slice(2);
const pages = await renderPdf(file, "tests/docx/out/_col", 1.2);
pages.forEach((p, i) => {
  const { width: w, height: h } = p.canvas;
  const d = p.canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let yellow = 0, red = 0, bbY = [w, h, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4, r = d[j], g = d[j + 1], b = d[j + 2];
    if (r > 225 && g > 215 && b < 140) { yellow++; bbY = [Math.min(bbY[0], x), Math.min(bbY[1], y), Math.max(bbY[2], x), Math.max(bbY[3], y)]; }
    if (r > 170 && g < 80 && b < 80) red++;
  }
  console.log(`exported page ${i + 1}: yellow highlight px ${yellow}${yellow ? ` (x ${(bbY[0] / w * 100).toFixed(0)}-${(bbY[2] / w * 100).toFixed(0)}%, y ${(bbY[1] / h * 100).toFixed(0)}-${(bbY[3] / h * 100).toFixed(0)}%)` : ""}, red px ${red}`);
});
for (const f of fs.readdirSync("tests/docx/out")) if (f.startsWith("_col")) fs.unlinkSync("tests/docx/out/" + f);
