// Builds the test documents. Everything is generated, nothing binary is committed.

import crypto from "node:crypto";
import sharp from "sharp";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  AlignmentType, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer, PageBreak, PageNumber, Paragraph, SectionType, Table, TableCell, TableRow, TextRun,
} from "docx";

export const PASSWORD = "TestPassword123!";

// Yoruba, Igbo, Hausa names and diacritics, currency and symbols.
export const UNICODE_TEXT = "Ọlájídé Adéọlá, Chinwẹ Ọkọrọ, Ibrahim Yusuf, Ngozi Ezẹ — ₦5,000.00 · ✓ © ® ™ ½ § 中文 العربية";

async function noisePng(size) {
  const raw = crypto.randomBytes(size * size * 3);
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}

// A realistic document: headings, paragraphs, a table, an image, a hyperlink, lists,
// page breaks, header/footer with page numbers, two sections, several fonts, Unicode.
export async function makeTestDocx({ imageSize = 120 } = {}) {
  const image = await noisePng(imageSize);
  const paragraphs = (n, font) => Array.from({ length: n }, (_, i) => new Paragraph({ children: [new TextRun({ text: `Paragraph ${i + 1}. ${UNICODE_TEXT}`, font })] }));
  const doc = new Document({
    creator: "PDFScanner tests",
    numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT }] }] },
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph("Confidential header — Ọlájídé")] }) },
        footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun("Page "), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(" of "), new TextRun({ children: [PageNumber.TOTAL_PAGES] })] })] }) },
        children: [
          new Paragraph({ text: "Test document", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: "Second heading", heading: HeadingLevel.HEADING_2 }),
          ...paragraphs(6, "Arial"),
          new Paragraph({ children: [new ExternalHyperlink({ link: "https://example.com/", children: [new TextRun({ text: "A hyperlink", style: "Hyperlink" })] })] }),
          new Paragraph({ text: "Bullet one", numbering: { reference: "bul", level: 0 } }),
          new Paragraph({ text: "Bullet two", numbering: { reference: "bul", level: 0 } }),
          new Table({ rows: [0, 1, 2].map((r) => new TableRow({ children: [0, 1, 2].map((c) => new TableCell({ children: [new Paragraph(`R${r}C${c} ${UNICODE_TEXT.slice(0, 12)}`)] })) })) }),
          new Paragraph({ children: [new ImageRun({ type: "png", data: image, transformation: { width: 120, height: 120 } })] }),
          new Paragraph({ children: [new PageBreak()] }),
          ...paragraphs(6, "Times New Roman"),
        ],
      },
      { properties: { type: SectionType.NEXT_PAGE }, children: [new Paragraph({ text: "Second section", heading: HeadingLevel.HEADING_1 }), ...paragraphs(4, "Courier New")] },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// A .docx of about `megabytes` MB that does not compress (random image data).
export async function makeLargeDocx(megabytes) {
  const base = await makeTestDocx();
  const zip = await JSZip.loadAsync(base);
  zip.file("word/media/big.bin", crypto.randomBytes(megabytes * 1024 * 1024), { compression: "STORE" });
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "STORE" }));
}

export async function retypeDocx(bytes, replace) {
  const zip = await JSZip.loadAsync(bytes);
  let ct = await zip.file("[Content_Types].xml").async("string");
  ct = replace(ct);
  zip.file("[Content_Types].xml", ct);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

export async function makePdf(text = "Hello protected world") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 200]).drawText(text, { x: 20, y: 100, size: 14, font });
  return new Uint8Array(await pdf.save());
}

// Document A: plain text, headings, page breaks, several pages.
export async function makeBasicDocx() {
  const children = [new Paragraph({ text: "Basic document", heading: HeadingLevel.TITLE })];
  for (let page = 1; page <= 4; page++) {
    children.push(new Paragraph({ text: `Chapter ${page}`, heading: HeadingLevel.HEADING_1 }));
    for (let i = 0; i < 12; i++) children.push(new Paragraph(`Chapter ${page}, paragraph ${i + 1}: The quick brown fox jumps over the lazy dog.`));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

// Document C: accented Latin, Unicode punctuation and symbols, non-ASCII names, several scripts.
export async function makeUnicodeDocx() {
  const lines = [
    "Yorùbá: Ọlájídé Adéọlá, Ṣọlá Àjàyí, Ọmọ́ Babátúndé",
    "Igbo: Chinwẹ Ọkọrọ, Ngozi Ezẹ, Ụzọ Ọma",
    "Hausa: Ibrahim Yusuf, Ɗan Bello, Ƙarama Sa’idu",
    "Français: « À bientôt, garçon ! » — déjà vu… œuvre, Zoë",
    "Symbols: ₦ € £ ¥ © ® ™ § ¶ † ‡ • ½ ¼ ¾ ± × ÷ ≈ ≠ ≤ ≥ ∞ ✓ ✗ ★",
    "Other scripts: 中文 日本語 한국어 العربية עברית Ελληνικά Русский",
    "Quotes: “double” ‘single’ „low“ ‹angle› — en–dash, em—dash",
  ];
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ text: "Unicode document", heading: HeadingLevel.HEADING_1 }), ...lines.map((t) => new Paragraph(t))] }] })));
}

// Passwords used for the compatibility checks. `nfc` / `nfd` are the same visible password
// written as precomposed and as decomposed characters: Office does not normalize them.
export const PASSWORDS = {
  simple: PASSWORD,
  longSymbols: "Correct-Horse_Battery.Staple/2024 #£€&@!%^*()[]{}<>?|~`'\"+=;:,",
  nonAscii: "Ọlájídé-Adéọlá-ñü-Ωmega",
  astral: "lock-\u{1F510}-key-\u{1D11E}",
  nfc: "caf\u00e9-pass-\u00f1",
  nfd: "cafe\u0301-pass-n\u0303",
};

// A valid PDF of about `megabytes` MB: one page per MB, each with an incompressible
// 1 MB greyscale image, so it looks like a real scan (big, binary, many objects).
export async function makeLargePdf(megabytes) {
  const { pushGraphicsState, popGraphicsState, scale, drawObject } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const pages = Math.max(1, Math.round(megabytes));
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([612, 792]);
    const ref = pdf.context.register(pdf.context.stream(crypto.randomBytes(1024 * 1024), { Type: "XObject", Subtype: "Image", Width: 1024, Height: 1024, ColorSpace: "DeviceGray", BitsPerComponent: 8 }));
    page.node.newXObject(`Im${i}`, ref);
    page.pushOperators(pushGraphicsState(), scale(612, 792), drawObject(`Im${i}`), popGraphicsState());
  }
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

// ---------------------------------------------------------------------------------------------
// Excel and PowerPoint fixtures (real files from real libraries), other package types, Flat OPC
// ---------------------------------------------------------------------------------------------

export async function makeXlsx({ rows = 200 } = {}) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget ₦");
  ws.columns = [{ header: "Name", key: "n", width: 28 }, { header: "Amount (₦)", key: "a", width: 16 }, { header: "Doubled", key: "d", width: 16 }];
  ws.getRow(1).font = { bold: true };
  for (let i = 0; i < rows; i++) ws.addRow({ n: i % 3 === 0 ? "Ọlájídé Adéọlá" : i % 3 === 1 ? "Chinwẹ Ọkọrọ" : "Ngozi Ezẹ", a: 1000 + i, d: { formula: `B${i + 2}*2`, result: (1000 + i) * 2 } });
  wb.addWorksheet("Notes").addRow([UNICODE_TEXT]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function makePptx() {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  const s1 = pptx.addSlide();
  s1.addText("Quarterly review — Ọlájídé", { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32 });
  s1.addImage({ data: `image/png;base64,${(await noisePng(80)).toString("base64")}`, x: 1, y: 2, w: 2, h: 2 });
  s1.addNotes("Speaker notes with ₦ and ✓");
  const s2 = pptx.addSlide();
  s2.addText(UNICODE_TEXT, { x: 0.5, y: 1, w: 9, h: 2, fontSize: 18 });
  s2.addTable([[{ text: "A" }, { text: "B" }], [{ text: "1" }, { text: "2" }]], { x: 0.5, y: 3, w: 4 });
  return new Uint8Array(await pptx.write({ outputType: "uint8array" }));
}

const CONTENT_TYPE = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  docm: "application/vnd.ms-word.document.macroEnabled.main+xml",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  dotm: "application/vnd.ms-word.template.macroEnabled.main+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
  xltm: "application/vnd.ms-excel.template.macroEnabled.main+xml",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
  potm: "application/vnd.ms-powerpoint.template.macroEnabled.main+xml",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml",
};
const APP_OF = (ext) => (ext.startsWith("d") ? "word" : ext.startsWith("x") ? "excel" : "powerpoint");

// Re-labels a real package (a .docx, .xlsx or .pptx) as another type of the same application, as
// those types are the same package with a different main-part content type, and adds a stand-in
// macro project for the macro-enabled types. A test stand-in: real macro files come from Office.
export async function asOfficeType(bytes, from, to) {
  const zip = await JSZip.loadAsync(bytes);
  let ct = await zip.file("[Content_Types].xml").async("string");
  assert(ct.includes(CONTENT_TYPE[from]), `${from} fixture has the expected main content type`);
  ct = ct.replace(CONTENT_TYPE[from], CONTENT_TYPE[to]);
  zip.file("[Content_Types].xml", ct);
  if (/m$/.test(to)) zip.file(`${{ word: "word", excel: "xl", powerpoint: "ppt" }[APP_OF(to)]}/vbaProject.bin`, crypto.randomBytes(3072));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}

// Writes a package as an Office "XML Document" (Flat OPC), the way Word, Excel and PowerPoint do:
// one <pkg:package> with a <pkg:part> per part (XML inline, everything else base64).
export async function toFlatOpc(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const types = await zip.file("[Content_Types].xml").async("string");
  // Attributes can come in any order ([Content_Types].xml writers differ), so read them by name.
  const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([A-Za-z:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const overrides = new Map([...types.matchAll(/<Override\b[^>]*>/g)].map((m) => attrs(m[0])).map((a) => [a.PartName, a.ContentType]));
  const defaults = new Map([...types.matchAll(/<Default\b[^>]*>/g)].map((m) => attrs(m[0])).map((a) => [a.Extension.toLowerCase(), a.ContentType]));
  let out = '<?xml version="1.0" standalone="yes"?>\n<?mso-application progid="Word.Document"?>\n<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">';
  for (const name of Object.keys(zip.files).filter((n) => !zip.files[n].dir && n !== "[Content_Types].xml")) {
    const partName = `/${name}`;
    const ext = name.split(".").pop().toLowerCase();
    const contentType = overrides.get(partName) ?? defaults.get(ext);
    if (!contentType) continue;
    const isXml = /xml$/.test(contentType) || ext === "rels" || ext === "xml";
    if (isXml) {
      const text = (await zip.file(name).async("string")).replace(/^﻿/, "").replace(/^<\?xml[^>]*\?>\s*/, "");
      out += `<pkg:part pkg:name="${partName}" pkg:contentType="${contentType}"><pkg:xmlData>${text}</pkg:xmlData></pkg:part>`;
    } else {
      const b64 = Buffer.from(await zip.file(name).async("uint8array")).toString("base64");
      out += `<pkg:part pkg:name="${partName}" pkg:contentType="${contentType}" pkg:compression="store"><pkg:binaryData>${b64}</pkg:binaryData></pkg:part>`;
    }
  }
  return `${out}</pkg:package>`;
}
