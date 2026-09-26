// Helpers for the font tests: real sfnt (TTF) bytes from the bundled WOFF fonts,
// and DOCX files that embed fonts the way Word does (obfuscated .odttf parts).
//
// Aptos itself is licensed (not redistributable), so the tests use the bundled
// open fonts as stand-ins: the pipeline treats any font file the same way, and
// the assertions prove which file's widths the layout used.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import JSZip from "jszip";
import * as d from "docx";
import { root } from "./harness.mjs";

const fontsource = path.join(root, "node_modules", "@fontsource");

// WOFF 1.0 -> plain sfnt, so the bytes look like a font file Word would embed.
export function woffToSfnt(woff) {
  const dv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (dv.getUint32(0) !== 0x774f4646) throw new Error("not a WOFF file");
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const offset = dv.getUint32(o + 4);
    const compLength = dv.getUint32(o + 8);
    const origLength = dv.getUint32(o + 12);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? zlib.inflateSync(raw) : Buffer.from(raw);
    tables.push({ tag: woff.subarray(o, o + 4), checksum: dv.getUint32(o + 16), data });
  }
  const headerSize = 12 + numTables * 16;
  let offset = headerSize;
  const positions = tables.map((t) => {
    const at = offset;
    offset += (t.data.length + 3) & ~3;
    return at;
  });
  const out = Buffer.alloc(offset);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= numTables) {
    pow *= 2;
    log++;
  }
  out.writeUInt16BE(pow * 16, 6);
  out.writeUInt16BE(log, 8);
  out.writeUInt16BE(numTables * 16 - pow * 16, 10);
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    Buffer.from(t.tag).copy(out, o);
    out.writeUInt32BE(t.checksum, o + 4);
    out.writeUInt32BE(positions[i], o + 8);
    out.writeUInt32BE(t.data.length, o + 12);
    t.data.copy(out, positions[i]);
  });
  return new Uint8Array(out);
}

// One face of a bundled font as plain TTF bytes. `subset` is the script file
// (latin, cyrillic ...).
export function fontBytes(family, bold, italic, subset = "latin") {
  const file = path.join(fontsource, family, "files", `${family}-${subset}-${bold ? 700 : 400}-${italic ? "italic" : "normal"}.woff`);
  return woffToSfnt(new Uint8Array(fs.readFileSync(file)));
}

// Sets the OS/2 fsType embedding bits (0x0002 = restricted licence) in place.
export function setFsType(sfnt, value) {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const numTables = dv.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (String.fromCharCode(...sfnt.subarray(o, o + 4)) === "OS/2") {
      dv.setUint16(dv.getUint32(o + 8) + 8, value);
      return sfnt;
    }
  }
  throw new Error("no OS/2 table");
}

// Obfuscates a font the way Word does (ECMA-376 Part 2, 17.8.1): XOR the first
// 32 bytes with the GUID's 16 bytes in reverse order.
export function obfuscate(sfnt, guid) {
  const hex = guid.replace(/[{}-]/g, "");
  const key = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  const out = new Uint8Array(sfnt);
  for (let i = 0; i < 32; i++) out[i] ^= key[15 - (i % 16)];
  return out;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Embeds fonts into a DOCX the way "Embed fonts in the file" does. `fonts` is
// [{ name, regular, bold, italic, boldItalic }] with sfnt bytes per slot.
export async function embedFonts(docx, fonts, { badKey = false } = {}) {
  const zip = await JSZip.loadAsync(docx);
  const rels = [];
  const entries = [];
  let n = 0;
  for (const font of fonts) {
    const slots = [];
    for (const [slot, tag] of [["regular", "embedRegular"], ["bold", "embedBold"], ["italic", "embedItalic"], ["boldItalic", "embedBoldItalic"]]) {
      if (!font[slot]) continue;
      n += 1;
      const guid = `{${[8, 4, 4, 4, 12].map((len) => Array.from({ length: len }, () => "0123456789ABCDEF"[Math.floor(Math.random() * 16)]).join("")).join("-")}}`;
      zip.file(`word/fonts/font${n}.odttf`, obfuscate(font[slot], badKey ? "{00000000-0000-0000-0000-000000000000}" : guid));
      rels.push(`<Relationship Id="rIdF${n}" Type="${R}/font" Target="fonts/font${n}.odttf"/>`);
      slots.push(`<w:${tag} r:id="rIdF${n}" w:fontKey="${guid}"/>`);
    }
    entries.push(`<w:font w:name="${font.name}"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>${slots.join("")}</w:font>`);
  }
  zip.file("word/fontTable.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="${W}" xmlns:r="${R}">${entries.join("")}</w:fonts>`);
  zip.file("word/_rels/fontTable.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  let types = await zip.file("[Content_Types].xml").async("string");
  if (!types.includes('Extension="odttf"')) {
    types = types.replace("<Override", '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Override');
  }
  zip.file("[Content_Types].xml", types);
  // The document must point at the font table.
  const docRels = await zip.file("word/_rels/document.xml.rels").async("string");
  if (!docRels.includes("/fontTable")) {
    zip.file("word/_rels/document.xml.rels", docRels.replace("</Relationships>", `<Relationship Id="rIdFT" Type="${R}/fontTable" Target="fontTable.xml"/></Relationships>`));
  }
  return zip.generateAsync({ type: "uint8array" });
}

// ---- a realistic document set in one font family --------------------------------------

const LOREM =
  "The quarterly review covered revenue, staffing and the product roadmap, and every region reported steady growth over the period, with the largest gains in the newest markets. ";

// Font names per role, so the same document can be built with Aptos or with the
// bundled fonts the stand-ins are copies of.
export const APTOS = { body: "Aptos", display: "Aptos Display", narrow: "Aptos Narrow", semibold: "Aptos SemiBold" };
export const TWINS = { body: "Arial", display: "Times New Roman", narrow: "Courier New" };

export async function buildFontDoc(names, { semibold } = {}) {
  const run = (text, o = {}) => new d.TextRun({ text, ...o });
  const para = (children, o = {}) => new d.Paragraph({ children, spacing: { after: 160, line: 276 }, ...o });
  const semi = semibold ? { font: names.semibold } : { font: names.body, bold: true };
  const children = [
    new d.Paragraph({ children: [run("Quarterly Review", { font: names.display, size: 48 })], spacing: { after: 240 } }),
    para([run(LOREM.repeat(3))]),
    para([run("Regular, "), run("bold, ", { bold: true }), run("italic, ", { italics: true }), run("bold italic, ", { bold: true, italics: true }), run("semibold heading ", semi), run(LOREM.repeat(2))]),
    para([run("Narrow figures: " + "1,234,567 ".repeat(8), { font: names.narrow }), run(LOREM)]),
    new d.Table({
      width: { size: 9000, type: d.WidthType.DXA },
      columnWidths: [3000, 3000, 3000],
      rows: Array.from({ length: 6 }, (_, r) =>
        new d.TableRow({
          children: [0, 1, 2].map((c) => new d.TableCell({ width: { size: 3000, type: d.WidthType.DXA }, children: [para([run(r === 0 ? `Column ${c + 1}` : `Row ${r} cell ${c + 1} ${LOREM.slice(0, 60 + c * 20)}`, { bold: r === 0 })])] })),
        }),
      ),
    }),
    para([run(LOREM.repeat(4))], { pageBreakBefore: true }),
    para([run("Second page, second paragraph. " + LOREM.repeat(3))]),
    new d.Paragraph({ children: [new d.PageBreak(), run("Third page. " + LOREM)] }),
  ];
  return d.Packer.toBuffer(
    new d.Document({
      styles: { default: { document: { run: { font: names.body, size: 22 } } } },
      sections: [{ children }],
    }),
  );
}
