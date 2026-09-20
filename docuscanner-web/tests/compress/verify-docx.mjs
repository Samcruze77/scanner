// Verifies a browser-compressed .docx against its original: identical XML parts,
// same package entries, pictures keep name/format, and it still converts to the
// same PDF text/layout through the DOCX engine.
import fs from "node:fs";
import JSZip from "jszip";
import sharp from "sharp";
import { convertFile } from "../docx/harness.mjs";
import { extractLines } from "../docx/pdftool.mjs";
const [origPath, compPath] = process.argv.slice(2);
const a = await JSZip.loadAsync(fs.readFileSync(origPath));
const b = await JSZip.loadAsync(fs.readFileSync(compPath));
const na = Object.keys(a.files), nb = Object.keys(b.files);
console.log("same entries & order:", JSON.stringify(na) === JSON.stringify(nb), `(${na.length})`);
let xmlSame = true;
for (const n of na) {
  if (a.files[n].dir || /\.(png|jpe?g)$/i.test(n)) continue;
  if ((await a.file(n).async("string")) !== (await b.file(n).async("string"))) { xmlSame = false; console.log("  changed:", n); }
}
console.log("every non-picture part byte-identical:", xmlSame);
for (const n of na.filter((x) => /media\//.test(x) && !a.files[x].dir)) {
  const ma = await sharp(await a.file(n).async("nodebuffer")).metadata();
  const mb = await sharp(await b.file(n).async("nodebuffer")).metadata();
  console.log(`  ${n}: ${ma.format} ${ma.width}x${ma.height} ${(a.files[n]._data.uncompressedSize / 1024) | 0}KB -> ${mb.format} ${mb.width}x${mb.height} ${(b.files[n]._data.uncompressedSize / 1024) | 0}KB`);
}
const pa = await extractLines((await (async () => { const r = await convertFile(origPath); fs.writeFileSync("tests/compress/out/_a.pdf", r.bytes); return "tests/compress/out/_a.pdf"; })()));
const pb = await extractLines((await (async () => { const r = await convertFile(compPath); fs.writeFileSync("tests/compress/out/_b.pdf", r.bytes); return "tests/compress/out/_b.pdf"; })()));
const ta = pa.flatMap((p) => p.lines.map((l) => `${p.number}|${l.y.toFixed(1)}|${l.text}`)).join("\n");
const tb = pb.flatMap((p) => p.lines.map((l) => `${p.number}|${l.y.toFixed(1)}|${l.text}`)).join("\n");
console.log("converted PDF layout identical (pages, line positions, text):", ta === tb, `(${pa.length} pages)`);
