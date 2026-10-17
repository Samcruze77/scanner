// Small-text legibility: the source PDF page and the page the Edit PDF flow exports, both cropped around the
// 6 pt and 8 pt lines at the SAME physical scale (300 dpi of the source page), side by side.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, renderPage } from "./lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const dirs = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("audit-")).map((d) => path.join(os.tmpdir(), d)).filter((d) => fs.existsSync(path.join(d, "edit-text.pdf"))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const scale = 300 / 72;
const a = await renderPage(path.join(here, "corpus", "text.pdf"), 1, scale);
const b = await renderPage(path.join(dirs[0], "edit-text.pdf"), 1, scale);
const crop = { x: 140, y: 120, w: 1100, h: 330 };
const out = createCanvas(crop.w, crop.h * 2 + 30);
const x = out.getContext("2d");
x.fillStyle = "#999"; x.fillRect(0, 0, out.width, out.height);
x.drawImage(a, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
x.drawImage(b, crop.x, crop.y, crop.w, crop.h, 0, crop.h + 30, crop.w, crop.h);
fs.writeFileSync(path.join(here, "visual-text.png"), out.toBuffer("image/png"));
console.log("saved");
