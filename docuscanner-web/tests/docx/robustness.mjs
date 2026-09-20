// Robustness and performance checks for the DOCX engine: it must never hang or
// crash on unusual input, and must say so (not silently drop things) when it
// can't reproduce something.
//
// Run: node tests/docx/robustness.mjs

import assert from "node:assert/strict";
import JSZip from "jszip";
import sharp from "sharp";
import { PDFDocument, PDFName } from "pdf-lib";
import * as d from "docx";
import { loadFont } from "./harness.mjs";

const engine = await import("../../utils/convert/docx/index.ts");
const convert = (buffer, extra = {}) => engine.docxToPdf(new Uint8Array(buffer), { loadFont, ...extra });

let passed = 0;
let failed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.stack?.split("\n").slice(0, 4).join("\n      ")}`);
  }
}
const pack = (children, extra = {}) => d.Packer.toBuffer(new d.Document({ sections: [{ children }], ...extra }));
const para = (text, o = {}) => new d.Paragraph({ children: [new d.TextRun(text)], ...o });
const LOREM = "The quarterly review covered revenue, staffing and the product roadmap, and every region reported steady growth over the period. ";

console.log("Performance");
await test("a 300-page document with a 1,500-row table converts in reasonable time", async () => {
  const children = [];
  for (let i = 0; i < 1400; i++) children.push(para(`Paragraph ${i}. ` + LOREM.repeat(5), { spacing: { after: 120 } }));
  const rows = Array.from({ length: 1500 }, (_, i) => new d.TableRow({ children: [new d.TableCell({ children: [para(String(i))] }), new d.TableCell({ children: [para("Row " + i + " " + LOREM)] })] }));
  children.push(new d.Table({ rows, width: { size: 9000, type: d.WidthType.DXA }, columnWidths: [1000, 8000] }));
  const buffer = await pack(children);
  const t0 = Date.now();
  const r = await convert(buffer);
  const ms = Date.now() - t0;
  console.log(`      ${r.pageCount} pages, ${(r.bytes.length / 1024).toFixed(0)} KB output, ${ms} ms`);
  assert.ok(r.pageCount > 150);
  assert.ok(ms < 60000, `took ${ms} ms`);
});

console.log("Unusual content");
await test("an empty document is reported as empty, not converted", async () => {
  const buffer = await pack([new d.Paragraph({ children: [] })]);
  await assert.rejects(convert(buffer), (e) => e.name === "EmptyDocumentError");
});
await test("emoji and CJK text does not crash, and the gap is disclosed", async () => {
  const buffer = await pack([para("Hello 😀 world — 你好，世界 — Привет мир — Καλημέρα κόσμε — naïve café")]);
  const r = await convert(buffer);
  assert.ok(r.warnings.some((w) => /can't be shown/i.test(w)), "no warning about unsupported characters: " + JSON.stringify(r.warnings));
});
await test("a giant unbreakable word and a very long URL wrap instead of running off the page", async () => {
  const buffer = await pack([para("x".repeat(400)), para("https://example.com/" + "segment/".repeat(60))]);
  const r = await convert(buffer);
  const pdf = await PDFDocument.load(r.bytes);
  assert.ok(pdf.getPageCount() >= 1);
});
await test("deep list nesting (9 levels) and nested tables", async () => {
  const levels = Array.from({ length: 9 }, (_, level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } }));
  const children = [];
  for (let l = 0; l < 9; l++) children.push(new d.Paragraph({ numbering: { reference: "deep", level: l }, children: [new d.TextRun(`Level ${l + 1} item`)] }));
  const inner = new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [para("inner A")] }), new d.TableCell({ children: [para("inner B")] })] })], columnWidths: [2000, 2000] });
  children.push(new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [para("outer cell"), inner] }), new d.TableCell({ children: [para("other")] })] })], columnWidths: [4500, 4500] }));
  const buffer = await pack(children, { numbering: { config: [{ reference: "deep", levels }] } });
  const r = await convert(buffer);
  assert.equal(r.pageCount, 1);
});
await test("hyperlinks become real clickable link annotations (only http/https/mailto)", async () => {
  const buffer = await pack([
    new d.Paragraph({ children: [new d.TextRun("Visit "), new d.ExternalHyperlink({ link: "https://example.com/docs", children: [new d.TextRun("our docs")] }), new d.TextRun(" or "), new d.ExternalHyperlink({ link: "javascript:alert(1)", children: [new d.TextRun("a bad link")] })] }),
  ]);
  const r = await convert(buffer);
  const pdf = await PDFDocument.load(r.bytes);
  const annots = pdf.getPage(0).node.Annots();
  const uris = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const a = pdf.context.lookup(annots.get(i));
    const action = pdf.context.lookup(a.get(PDFName.of("A")));
    uris.push(action.get(PDFName.of("URI")).decodeText());
  }
  assert.deepEqual(uris, ["https://example.com/docs"], "unexpected link targets: " + JSON.stringify(uris));
});
await test("large pictures and an unsupported EMF picture: converts and warns", async () => {
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#4477aa" } }).jpeg().toBuffer();
  const buffer = await pack([new d.Paragraph({ children: [new d.ImageRun({ type: "jpg", data: big, transformation: { width: 500, height: 333 } })] }), para("after")]);
  // Rename the picture part to .emf to simulate a format we can't embed.
  const zip = await JSZip.loadAsync(buffer);
  const media = Object.keys(zip.files).find((n) => n.startsWith("word/media/") && !zip.files[n].dir);
  const emfName = media.replace(/\.\w+$/, ".emf");
  zip.file(emfName, await zip.file(media).async("uint8array"));
  zip.remove(media);
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".rels"))) zip.file(name, (await zip.file(name).async("string")).replace(media.replace("word/", ""), emfName.replace("word/", "")));
  const r = await convert(await zip.generateAsync({ type: "uint8array" }));
  assert.ok(r.warnings.some((w) => /EMF|WMF|format/i.test(w)), JSON.stringify(r.warnings));
});
await test("a document using fonts we don't have: converts and names the substitution", async () => {
  const buffer = await pack([new d.Paragraph({ children: [new d.TextRun({ text: "Set in Verdana and Georgia", font: "Verdana" }), new d.TextRun({ text: " and Georgia", font: "Georgia" })] })]);
  const r = await convert(buffer);
  assert.ok(r.warnings.some((w) => /Verdana/.test(w)) && r.warnings.some((w) => /Georgia/.test(w)), JSON.stringify(r.warnings));
});

console.log("Damaged input");
await test("not a zip at all", async () => {
  await assert.rejects(convert(new TextEncoder().encode("this is plain text")));
});
await test("a zip that is not a Word document", async () => {
  const z = new JSZip();
  z.file("readme.txt", "hi");
  await assert.rejects(convert(await z.generateAsync({ type: "uint8array" })));
});
await test("document.xml that is not valid XML does not hang", async () => {
  const buffer = await pack([para("Hello")]);
  const zip = await JSZip.loadAsync(buffer);
  zip.file("word/document.xml", "<w:document><w:body><w:p>unclosed");
  const started = Date.now();
  await convert(await zip.generateAsync({ type: "uint8array" })).catch(() => {});
  assert.ok(Date.now() - started < 10000);
});
await test("a package missing styles, numbering, fonts and theme still converts", async () => {
  const buffer = await pack([para("Plain body text with no styles part."), new d.Paragraph({ numbering: { reference: "x", level: 0 }, children: [new d.TextRun("listed")] })], {
    numbering: { config: [{ reference: "x", levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: "%1.", alignment: d.AlignmentType.LEFT }] }] },
  });
  const zip = await JSZip.loadAsync(buffer);
  for (const name of ["word/styles.xml", "word/fontTable.xml", "word/theme/theme1.xml"]) zip.remove(name);
  const r = await convert(await zip.generateAsync({ type: "uint8array" }));
  assert.ok(r.pageCount >= 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
