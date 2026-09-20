// Builds an image-only ("scanned") PDF from real Word-rendered pages: no text layer at all, so
// PDF -> Word has to use OCR. Two pages, JPEG page images.
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { renderPdf } from "../docx/pdftool.mjs";
const dir = new URL(".", import.meta.url).pathname.replace(/^\//, "");
const sources = [["tests/docx/fixtures/07-letter.word.pdf", 0], ["tests/docx/fixtures/03-spacing.word.pdf", 0]];
const pdf = await PDFDocument.create();
for (const [file, index] of sources) {
  const pages = await renderPdf(file, "tests/docx/out/_scan", 2.2);
  const canvas = pages[index].canvas;
  const jpg = await pdf.embedJpg(canvas.toBuffer("image/jpeg", 88));
  const page = pdf.addPage([595, 842]);
  page.drawImage(jpg, { x: 0, y: 0, width: 595, height: 842 });
}
for (const f of fs.readdirSync("tests/docx/out")) if (f.startsWith("_scan")) fs.unlinkSync("tests/docx/out/" + f);
fs.writeFileSync(dir + "scanned.pdf", await pdf.save());
console.log("scanned.pdf", fs.statSync(dir + "scanned.pdf").size, "bytes");
