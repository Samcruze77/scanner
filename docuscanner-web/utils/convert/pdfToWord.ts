"use client";

// PDF -> Word (.docx), entirely in the browser.
//
// Digital PDFs (real, selectable text): PDF.js reports every string with its
// position, size and font; pdfLayout.ts rebuilds headings, paragraphs, lists,
// tables and alignment from that geometry, and the `docx` library writes them
// as an editable Word document, one Word section per PDF page so page order and
// page size are kept.
//
// Scanned PDFs (pages that are just pictures): read with the same free
// in-browser OCR used for "Extract text", and written as plain paragraphs.
//
// This is reconstruction, not conversion: complex layouts (columns, text around
// pictures, exact spacing) and images in the PDF are not reproduced.

import { getOcrLimits } from "@/utils/ocr/config";
import { runOcr } from "@/utils/ocr/run";
import type { PlanId } from "@/utils/features/plans";
import { openPdf, PdfError } from "@/utils/pdf/pdfjs";
import { renderPdfPage } from "@/utils/pdf/render";
import { createInitialPage, type ScannerPage } from "@/utils/scanner/page";
import { estimateBodySize, layoutPage, type Block, type Family, type PageLayout } from "./pdfLayout";
import type { PositionedText } from "./tableExtract";

export const MAX_PDF_TO_WORD_PAGES = 100;

// Same rules as PDF -> Excel: a page with almost no text is treated as a scan.
const MIN_TEXT_CHARS = 8;
const OCR_RENDER_LONG_SIDE_PX = 2000;
const PREVIEW_BLOCKS = 12;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type PdfToWordProgress =
  | { phase: "reading"; page: number; pageCount: number }
  | { phase: "ocr"; page: number; pageCount: number; fraction: number }
  | { phase: "building" };

export interface PdfToWordOptions {
  plan: PlanId;
  ocrEnabled: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: PdfToWordProgress) => void;
}

export interface PreviewLine {
  kind: "heading" | "paragraph" | "list" | "table";
  text: string;
}

export interface PdfToWordResult {
  blob: Blob;
  pageCount: number;
  digitalPages: number[];
  ocrPages: number[];
  // Pages with no text that couldn't be read (OCR off, over the limit, or empty).
  unreadPages: number[];
  stats: { headings: number; paragraphs: number; listItems: number; tables: number };
  preview: PreviewLine[];
}

interface FontInfo {
  bold: boolean;
  italic: boolean;
  family: Family;
}

interface PageData {
  pageNumber: number;
  width: number;
  height: number;
  items: PositionedText[];
  source: "digital" | "ocr" | "unread";
  ocrText?: string;
  scanned?: ScannerPage;
}

const BOLD_NAME = /bold|black|heavy|semibold|demi/i;
const ITALIC_NAME = /italic|oblique/i;

interface PdfObjects {
  has(id: string): boolean;
  get(id: string): unknown;
}

// After PDF.js has loaded a page's fonts (getOperatorList), its font objects
// say what each font really is -- the only reliable way to know bold/italic.
function readFontInfo(objects: PdfObjects, fontName: string): FontInfo {
  let font: { name?: string; bold?: boolean; italic?: boolean; fallbackName?: string } | null = null;
  try {
    font = objects.has(fontName) ? (objects.get(fontName) as typeof font) : null;
  } catch {
    font = null;
  }
  const name = font?.name ?? "";
  const fallback = font?.fallbackName ?? "";
  return {
    bold: !!font?.bold || BOLD_NAME.test(name),
    italic: !!font?.italic || ITALIC_NAME.test(name),
    family: fallback === "serif" ? "serif" : fallback === "monospace" ? "mono" : "sans",
  };
}

function cancelled(): DOMException {
  return new DOMException("Cancelled", "AbortError");
}

async function readPages(file: File, options: PdfToWordOptions): Promise<PageData[]> {
  const { doc, destroy } = await openPdf(file, { maxPages: MAX_PDF_TO_WORD_PAGES });
  const limits = getOcrLimits(options.plan);
  const pages: PageData[] = [];
  let ocrCandidates = 0;

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (options.signal?.aborted) throw cancelled();
      options.onProgress?.({ phase: "reading", page: pageNumber, pageCount: doc.numPages });

      const page = await doc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        // Loads the page's fonts so bold/italic can be read from them.
        await page.getOperatorList();

        const fonts = new Map<string, FontInfo>();
        const items: PositionedText[] = [];
        let characters = 0;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          characters += item.str.trim().length;
          if (item.fontName && !fonts.has(item.fontName)) {
            fonts.set(item.fontName, readFontInfo(page.commonObjs as unknown as PdfObjects, item.fontName));
          }
          const info = fonts.get(item.fontName);
          items.push({
            str: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: item.height || Math.abs(item.transform[3]) || 10,
            bold: info?.bold,
            italic: info?.italic,
            family: info?.family,
          });
        }

        const data: PageData = { pageNumber, width: viewport.width, height: viewport.height, items, source: "digital" };
        if (characters >= MIN_TEXT_CHARS) {
          pages.push(data);
          continue;
        }

        data.source = "unread";
        data.items = [];
        if (options.ocrEnabled && ocrCandidates < limits.maxPagesPerRun) {
          ocrCandidates++;
          const rendered = await renderPdfPage(page, OCR_RENDER_LONG_SIDE_PX);
          data.scanned = createInitialPage({ id: crypto.randomUUID(), ...rendered }, { skipDetection: true });
        }
        pages.push(data);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await destroy();
  }
  return pages;
}

async function readScannedPages(pages: PageData[], options: PdfToWordOptions): Promise<void> {
  const targets = pages.filter((p) => p.scanned);
  if (targets.length === 0) return;
  if (options.signal?.aborted) throw cancelled();

  const { result } = await runOcr({
    targets: targets.map((p) => ({ page: p.scanned as ScannerPage, pageNumber: p.pageNumber })),
    scope: "document",
    limits: getOcrLimits(options.plan),
    signal: options.signal,
    onProgress: (progress) => {
      options.onProgress?.({
        phase: "ocr",
        page: targets[Math.min(progress.pageIndex, targets.length - 1)].pageNumber,
        pageCount: targets.length,
        fraction: progress.phase === "loading_engine" ? 0 : (progress.pageIndex + progress.fraction) / progress.pageCount,
      });
    },
  });

  for (const read of result.pages) {
    const page = targets.find((p) => p.pageNumber === read.pageNumber);
    if (!page) continue;
    if (read.text.trim()) {
      page.ocrText = read.text;
      page.source = "ocr";
    }
  }
  for (const page of targets) page.scanned = undefined;
}

// ---- building the .docx -------------------------------------------------------------

const FONT_NAMES: Record<Family, string> = { sans: "Arial", serif: "Times New Roman", mono: "Courier New" };
const twips = (points: number) => Math.round(points * 20);
const halfPoints = (points: number) => Math.max(12, Math.min(144, Math.round(points * 2)));

function blockText(block: Block): string {
  return block.kind === "table" ? block.rows.map((r) => r.join(" | ")).join(" / ") : block.runs.map((r) => r.text).join("");
}

// Plain paragraphs from OCR text: blank lines separate paragraphs; line breaks
// inside a paragraph are kept, since OCR can't tell a wrapped line from a
// deliberate one.
function blocksFromOcr(text: string): Block[] {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map(
      (lines): Block => ({
        kind: "paragraph",
        runs: lines.map((line, i) => ({ text: (i > 0 ? "\n" : "") + line, bold: false, italic: false, sizePt: 11, family: "sans" })),
        align: "left",
        indentPt: 0,
        heading: 0,
        list: null,
        spaceBeforePt: 0,
      }),
    );
}

export async function convertPdfToWord(file: File, options: PdfToWordOptions): Promise<PdfToWordResult> {
  const pages = await readPages(file, options);
  await readScannedPages(pages, options);

  const readable = pages.filter((p) => p.source !== "unread");
  if (readable.length === 0) throw new PdfError("pdf_no_text");

  options.onProgress?.({ phase: "building" });
  const bodySize = estimateBodySize(pages.filter((p) => p.source === "digital").map((p) => p.items));

  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, LevelFormat, BorderStyle, SectionType } = docx;

  const heads = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
  const stats = { headings: 0, paragraphs: 0, listItems: 0, tables: 0 };
  const preview: PreviewLine[] = [];
  const bullet = String.fromCharCode(0x2022);
  const hollowBullet = String.fromCharCode(0x25e6);

  let numberInstance = 0;
  let previousWasNumbered = false;

  const sections = readable.map((page) => {
    const layout: PageLayout =
      page.source === "digital"
        ? layoutPage(page.items, page.width, page.height, bodySize)
        : { blocks: blocksFromOcr(page.ocrText ?? ""), marginLeftPt: 72, marginRightPt: 72, marginTopPt: 72, marginBottomPt: 72 };
    const textWidthPt = page.width - layout.marginLeftPt - layout.marginRightPt;

    const children = layout.blocks.map((block) => {
      if (preview.length < PREVIEW_BLOCKS) {
        const kind = block.kind === "table" ? "table" : block.heading ? "heading" : block.list ? "list" : "paragraph";
        preview.push({ kind, text: blockText(block).slice(0, 140) });
      }

      if (block.kind === "table") {
        stats.tables++;
        previousWasNumbered = false;
        const total = block.columnWidthsPt.reduce((n, w) => n + w, 0) || 1;
        const columnWidths = block.columnWidthsPt.map((w) => Math.max(400, twips((w / total) * textWidthPt)));
        const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
        return new Table({
          columnWidths,
          width: { size: columnWidths.reduce((n, w) => n + w, 0), type: WidthType.DXA },
          borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
          rows: block.rows.map(
            (cells) =>
              new TableRow({
                children: columnWidths.map(
                  (width, i) =>
                    new TableCell({
                      width: { size: width, type: WidthType.DXA },
                      children: [new Paragraph({ children: [new TextRun({ text: cells[i] ?? "", size: halfPoints(bodySize), font: FONT_NAMES.sans })] })],
                    }),
                ),
              }),
          ),
        });
      }

      if (block.heading) stats.headings++;
      else if (block.list) stats.listItems++;
      else stats.paragraphs++;

      let numbering: { reference: string; level: number; instance?: number } | undefined;
      if (block.list) {
        if (block.list.type === "number") {
          // A new run of numbered items restarts at 1.
          if (!previousWasNumbered) numberInstance++;
          numbering = { reference: "numbers", level: block.list.level, instance: numberInstance };
        } else {
          numbering = { reference: "bullets", level: block.list.level };
        }
      }
      previousWasNumbered = !!block.list && block.list.type === "number";

      return new Paragraph({
        heading: block.heading ? heads[block.heading - 1] : undefined,
        alignment: block.align === "center" ? AlignmentType.CENTER : block.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
        indent: !block.list && block.indentPt > 0 ? { left: twips(block.indentPt) } : undefined,
        spacing: { before: twips(block.spaceBeforePt) },
        numbering,
        children: block.runs.map((run) => {
          // OCR paragraphs carry line breaks as a leading newline on a run.
          const lineBreak = run.text.startsWith("\n");
          return new TextRun({
            text: lineBreak ? run.text.slice(1) : run.text,
            break: lineBreak ? 1 : undefined,
            bold: run.bold || undefined,
            italics: run.italic || undefined,
            size: halfPoints(run.sizePt),
            font: FONT_NAMES[run.family],
          });
        }),
      });
    });

    return {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: twips(page.width), height: twips(page.height) },
          margin: {
            top: twips(layout.marginTopPt),
            bottom: twips(layout.marginBottomPt),
            left: twips(layout.marginLeftPt),
            right: twips(layout.marginRightPt),
          },
        },
      },
      children: children.length > 0 ? children : [new Paragraph({ children: [] })],
    };
  });

  const document = new Document({
    creator: "PDFScanner",
    title: file.name.replace(/\.pdf$/i, ""),
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: bullet, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.BULLET, text: hollowBullet, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
          ],
        },
        {
          reference: "numbers",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
          ],
        },
      ],
    },
    sections,
  });

  const blob = new Blob([await Packer.toArrayBuffer(document)], { type: DOCX_MIME });
  return {
    blob,
    pageCount: pages.length,
    digitalPages: pages.filter((p) => p.source === "digital").map((p) => p.pageNumber),
    ocrPages: pages.filter((p) => p.source === "ocr").map((p) => p.pageNumber),
    unreadPages: pages.filter((p) => p.source === "unread").map((p) => p.pageNumber),
    stats,
    preview,
  };
}
