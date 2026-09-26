// Font fidelity tests for the DOCX engine: a document set in Aptos (Word's
// current default font) must use a real Aptos file when one is available and say
// so honestly when it isn't -- never quietly lay out with Carlito's widths.
//
// Aptos is licensed, not redistributable, so it can't ship with the repo. The
// tests use the bundled open fonts as stand-ins ("Aptos" = Arimo, "Aptos Display"
// = Tinos, "Aptos Narrow" = Cousine, "Aptos SemiBold" = Arimo Bold): the pipeline
// treats every font file alike, and the assertions prove whose widths the layout
// used. With a real Aptos file, compare against Word's own PDF instead:
//   DOCX_FONT_FILES="C:/fonts/Aptos.ttf;C:/fonts/Aptos-Bold.ttf;..." node tests/docx/compare.mjs --dir real
//
// Run: npm run test:docx:fonts

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as d from "docx";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { loadFont, outDir } from "./harness.mjs";
import { extractLines } from "./pdftool.mjs";
import { APTOS, TWINS, buildFontDoc as buildDoc, embedFonts, fontBytes, setFsType } from "./font-helpers.mjs";

const engine = await import("../../utils/convert/docx/index.ts");
const files = await import("../../utils/convert/docx/fontFiles.ts");
const convert = (buffer, extra = {}) => engine.docxToPdf(new Uint8Array(buffer), { loadFont, ...extra });

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.stack?.split("\n").slice(0, 5).join("\n      ")}`);
  }
}

// ---- the fixture: a realistic Aptos document (see buildFontDoc) --------------------------

// Stand-in font files, as plain TTF bytes.
const faces = (family) => ({ regular: fontBytes(family, false, false), bold: fontBytes(family, true, false), italic: fontBytes(family, false, true), boldItalic: fontBytes(family, true, true) });
const standIns = [
  { name: "Aptos", ...faces("arimo") },
  { name: "Aptos Display", ...faces("tinos") },
  { name: "Aptos Narrow", ...faces("cousine") },
  // Word lists SemiBold as its own family whose regular slot is the semibold face.
  { name: "Aptos SemiBold", regular: fontBytes("arimo", true, false) },
];

const lines = async (bytes, name) => {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, bytes);
  return (await extractLines(file)).map((p) => p.lines.map((l) => ({ text: l.text, x: l.x, y: l.y, size: l.size })));
};
const sameLayout = (a, b, tol = 0.05) => {
  assert.equal(a.length, b.length, `page count ${a.length} vs ${b.length}`);
  a.forEach((page, p) => {
    assert.equal(page.length, b[p].length, `page ${p + 1}: ${page.length} vs ${b[p].length} lines`);
    page.forEach((line, i) => {
      const o = b[p][i];
      assert.equal(line.text.replace(/\s+/g, ""), o.text.replace(/\s+/g, ""), `page ${p + 1} line ${i + 1} text`);
      assert.ok(Math.abs(line.x - o.x) <= tol && Math.abs(line.y - o.y) <= tol && Math.abs(line.size - o.size) <= tol, `page ${p + 1} line ${i + 1} "${line.text.slice(0, 30)}": (${line.x.toFixed(2)},${line.y.toFixed(2)}) vs (${o.x.toFixed(2)},${o.y.toFixed(2)})`);
    });
  });
};

const aptosDoc = await buildDoc(APTOS, { semibold: true });
const twinDoc = await buildDoc(TWINS);
const embedded = await embedFonts(aptosDoc, standIns);

console.log("Without an Aptos file");
const bare = await convert(aptosDoc);
await test("falls back honestly: warns per font and reports the missing fonts", async () => {
  assert.ok(bare.warnings.includes("Aptos font required — upload the font file or enable installed fonts. Until then Carlito is used instead, so line and page breaks may differ from Word."), JSON.stringify(bare.warnings));
  assert.deepEqual(bare.missingFonts.sort(), ["Aptos", "Aptos Display", "Aptos Narrow", "Aptos SemiBold"]);
});
await test("existing fonts (Calibri, Arial ...) are unaffected: no font warning, no missing fonts", async () => {
  const r = await convert(twinDoc);
  assert.deepEqual(r.missingFonts, []);
  assert.ok(!r.warnings.some((w) => /available/.test(w)), JSON.stringify(r.warnings));
});

console.log("Aptos embedded in the document (Word's \"Embed fonts in the file\")");
const withEmbedded = await convert(embedded);
await test("no substitution warning and nothing reported missing", async () => {
  assert.deepEqual(withEmbedded.warnings, []);
  assert.deepEqual(withEmbedded.missingFonts, []);
});
await test("wrapping, pagination, table and page breaks follow the font's own widths", async () => {
  // The stand-ins are copies of Arimo/Tinos/Cousine, so laying the Aptos
  // document out with them must equal laying out the Arial/TNR/Courier twin.
  const ref = await convert(twinDoc);
  sameLayout(await lines(withEmbedded.bytes, "fonts-aptos-embedded.pdf"), await lines(ref.bytes, "fonts-aptos-twin.pdf"));
});
await test("it is not the Carlito fallback: layout differs from the unsupplied conversion", async () => {
  const a = await lines(withEmbedded.bytes, "fonts-aptos-embedded.pdf");
  const b = await lines(bare.bytes, "fonts-aptos-bare.pdf");
  const flat = (pages) => pages.flat().map((l) => `${l.text}@${l.x.toFixed(1)},${l.y.toFixed(1)}`).join("|");
  assert.notEqual(flat(a), flat(b));
});
await test("the PDF embeds the supplied fonts and no Carlito", async () => {
  const pdf = await PDFDocument.load(withEmbedded.bytes);
  const names = [...pdf.context.enumerateIndirectObjects()]
    .map(([, obj]) => (obj instanceof PDFDict ? obj.get(PDFName.of("BaseFont"))?.toString() ?? "" : ""))
    .filter(Boolean)
    .join(" ");
  assert.match(names, /Arimo/);
  assert.match(names, /Tinos/);
  assert.doesNotMatch(names, /Carlito/);
});
await test("a font embedded with a wrong key is ignored, not crashed on", async () => {
  const r = await convert(await embedFonts(aptosDoc, standIns, { badKey: true }));
  assert.ok(r.missingFonts.includes("Aptos"));
  assert.ok(r.pageCount >= 3);
});
await test("an embedded copy of a bundled font (Calibri) does not replace its exact twin", async () => {
  const calibriDoc = await buildDoc({ body: "Calibri", display: "Calibri", narrow: "Calibri" });
  const base = await convert(calibriDoc);
  const withCopy = await convert(await embedFonts(calibriDoc, [{ name: "Calibri", ...faces("arimo") }]));
  sameLayout(await lines(base.bytes, "fonts-calibri-base.pdf"), await lines(withCopy.bytes, "fonts-calibri-copy.pdf"), 0.001);
});

console.log("Aptos files supplied by the caller (added by the person, or installed on their device)");
await test("supplied files are used and the warning disappears", async () => {
  const supplied = [];
  for (const f of standIns) for (const slot of ["regular", "bold", "italic", "boldItalic"]) if (f[slot]) supplied.push({ bytes: f[slot], family: f.name });
  const r = await convert(aptosDoc, { fontFiles: supplied });
  assert.deepEqual(r.warnings, []);
  sameLayout(await lines(r.bytes, "fonts-aptos-supplied.pdf"), await lines(withEmbedded.bytes, "fonts-aptos-embedded.pdf"));
});
await test("the lookup hook is asked only for fonts that are neither bundled nor supplied", async () => {
  let asked = [];
  const r = await convert(aptosDoc, {
    findFonts: async (names) => {
      asked = names;
      return standIns.flatMap((f) => ["regular", "bold", "italic", "boldItalic"].filter((s) => f[s]).map((s) => ({ bytes: f[s], family: f.name })));
    },
  });
  assert.ok(asked.includes("Aptos") && asked.includes("Aptos Display"), JSON.stringify(asked));
  assert.ok(!asked.includes("Calibri") && !asked.includes("Arial"), JSON.stringify(asked));
  assert.deepEqual(r.missingFonts, []);
});
await test("a failing lookup hook falls back instead of breaking the conversion", async () => {
  const r = await convert(aptosDoc, { findFonts: async () => { throw new Error("permission denied"); } });
  assert.ok(r.missingFonts.includes("Aptos"));
});
await test("only some styles supplied: the missing bold/italic is disclosed", async () => {
  const r = await convert(aptosDoc, { fontFiles: [{ bytes: fontBytes("arimo", false, false), family: "Aptos" }] });
  assert.ok(r.warnings.some((w) => /"aptos" has no bold font file/i.test(w)), JSON.stringify(r.warnings));
  assert.ok(!r.missingFonts.includes("Aptos"));
});
await test("characters the font lacks (Cyrillic in a Latin-only file) still draw, not '?'", async () => {
  const buffer = await d.Packer.toBuffer(new d.Document({ sections: [{ children: [new d.Paragraph({ children: [new d.TextRun({ text: "Hello Привет", font: "Aptos" })] })] }] }));
  const r = await convert(buffer, { fontFiles: [{ bytes: fontBytes("arimo", false, false, "latin"), family: "Aptos" }] });
  const [page] = await lines(r.bytes, "fonts-fallback-glyphs.pdf");
  assert.match(page.map((l) => l.text).join(" "), /Привет/);
  assert.ok(!r.warnings.some((w) => /question mark/.test(w)), JSON.stringify(r.warnings));
});
await test("a font whose licence forbids embedding is refused and disclosed", async () => {
  const restricted = setFsType(fontBytes("arimo", false, false), 0x0002);
  const r = await convert(aptosDoc, { fontFiles: [{ bytes: restricted, family: "Aptos" }] });
  assert.ok(r.warnings.some((w) => /doesn't allow embedding/.test(w) && /aptos/i.test(w)), JSON.stringify(r.warnings));
  assert.ok(r.missingFonts.includes("Aptos"));
});

console.log("Reading font files");
await test("family, weight and slant are read from the font's own name table", async () => {
  for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]]) {
    const info = files.readFontFile(fontBytes("arimo", bold, italic));
    assert.deepEqual({ family: info.family, bold: info.bold, italic: info.italic, embeddable: info.embeddable }, { family: "arimo", bold, italic, embeddable: true });
  }
});
await test("non-fonts and font collections are rejected", async () => {
  assert.equal(files.readFontFile(new Uint8Array([1, 2, 3, 4, 5])), null);
  assert.equal(new files.FontRegistry().add(new Uint8Array(64)), false);
});
await test("names match the way Word compares them (case and spacing)", async () => {
  const registry = new files.FontRegistry();
  registry.add({ bytes: fontBytes("arimo", true, false), family: "Aptos SemiBold" });
  assert.ok(registry.has("  aptos   semibold "));
  assert.ok(!registry.has("Aptos"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
