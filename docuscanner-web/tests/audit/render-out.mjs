// Renders a page of the newest audit output PDF to PNG.  node tests/audit/render-out.mjs word.pdf 1 [scale]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage } from "./lib.mjs";
const [name, page, scale] = [process.argv[2], Number(process.argv[3] ?? 1), Number(process.argv[4] ?? 1)];
const dirs = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("audit-")).map((d) => path.join(os.tmpdir(), d)).filter((d) => fs.existsSync(path.join(d, name))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const c = await renderPage(path.join(dirs[0], name), page, scale);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), `out-${name}-p${page}.png`);
fs.writeFileSync(out, c.toBuffer("image/png"));
console.log(out);
