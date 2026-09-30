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
