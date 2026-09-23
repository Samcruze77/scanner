"use client";

// Builds a Word (.docx) document straight from OCR'd page text -- no digital
// PDF layout involved. Shared by two callers: PDF -> Word's own scanned-page
// fallback keeps its richer per-page mixed-layout builder (some pages
// digital, some OCR, on the same document) and doesn't use this file; this
// exists for the scanner's own multi-format export, where every page is
// always a camera/upload image and there is no digital text layer to
// preserve structure from. Reuses pdfToWord.ts's blocksFromOcr() so both
// places split OCR text into paragraphs the exact same way.

import { blocksFromOcr } from "./pdfToWord";

const A4_WIDTH_PT = 595;
const A4_HEIGHT_PT = 842;
const MARGIN_PT = 72;
const BODY_SIZE_PT = 11;

const twips = (points: number) => Math.round(points * 20);
const halfPoints = (points: number) => Math.max(12, Math.min(144, Math.round(points * 2)));

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface OcrDocxPage {
  pageNumber: number;
  text: string;
}

export async function buildDocxFromOcrPages(pages: OcrDocxPage[], title: string): Promise<Blob> {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, SectionType } = docx;

  const sections = pages.map((page) => {
    // blocksFromOcr() only ever produces paragraph blocks (there is no table
    // detection for plain OCR text), but its return type is the shared
    // Block union -- narrow it rather than widening this file's own types.
    const blocks = blocksFromOcr(page.text).filter((block) => block.kind === "paragraph");
    const children = blocks.map(
      (block) =>
        new Paragraph({
          children: block.runs.map((run) => {
            const lineBreak = run.text.startsWith("\n");
            return new TextRun({
              text: lineBreak ? run.text.slice(1) : run.text,
              break: lineBreak ? 1 : undefined,
              size: halfPoints(BODY_SIZE_PT),
              font: "Arial",
            });
          }),
        }),
    );
    return {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: twips(A4_WIDTH_PT), height: twips(A4_HEIGHT_PT) },
          margin: { top: twips(MARGIN_PT), bottom: twips(MARGIN_PT), left: twips(MARGIN_PT), right: twips(MARGIN_PT) },
        },
      },
      children: children.length > 0 ? children : [new Paragraph({ children: [] })],
    };
  });

  const document = new Document({ creator: "PDFScanner", title, sections });
  const buffer = await Packer.toArrayBuffer(document);
  return new Blob([buffer], { type: DOCX_MIME });
}
