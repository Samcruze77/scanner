// Crops the 6 pt caption and a vector hairline area from the printed PDF (tests/audit/out-print/plain.pdf) at 300 dpi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, renderPage } from "./lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const f = path.join(here, "out-print", process.argv[2] ?? "plain.pdf");
const c = await renderPage(f, 1, 300 / 72);
// the printed page sits inside a margin; crop the caption line under the photo and the hairline block
const crop = { x: 150, y: 2290, w: 900, h: 130 };
const out = createCanvas(crop.w, crop.h);
out.getContext("2d").drawImage(c, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
fs.writeFileSync(path.join(here, "visual-print-" + (process.argv[2] ?? "plain.pdf").replace(".pdf", "") + ".png"), out.toBuffer("image/png"));
console.log("saved", c.width, c.height);
