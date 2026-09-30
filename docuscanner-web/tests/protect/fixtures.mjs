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
