// Prints the text layer of the newest audit output PDFs matching a name.   node tests/audit/dump-text.mjs word.pdf [filter]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pdfReport } from "./lib.mjs";
const name = process.argv[2];
const dirs = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("audit-")).map((d) => path.join(os.tmpdir(), d)).filter((d) => fs.existsSync(path.join(d, name))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const rep = await pdfReport(path.join(dirs[0], name), []);
const filter = process.argv[3];
const t = rep.allText.replace(/\s+/g, " ");
console.log(filter ? t.split(filter).slice(0, 3).map((s, i, a) => (i < a.length - 1 ? s.slice(-60) + filter : "")).join(" ... ") + " => " + t.slice(t.indexOf(filter) - 40, t.indexOf(filter) + 200) : t.slice(0, 1500));
