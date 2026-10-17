import fs from "node:fs";
import { pdfReport, renderPage } from "./lib.mjs";
const f = "tests/audit/corpus/document.word.pdf";
const r = await pdfReport(f, ["TBL-R0C0", "TBL-R3C2", "DOCX-P30"]);
console.log("Word's own PDF: pages", r.pageCount, "text", r.textChars, "markers", r.markersFound + "/" + r.markersTotal, "images", JSON.stringify(r.pages.map((p) => p.images.map((i) => [i.px.join("x"), i.wMm + "x" + i.hMm, i.dpi]))));
const c = await renderPage(f, 1, 0.9);
fs.writeFileSync("tests/audit/out-word-reference-p1.png", c.toBuffer("image/png"));
