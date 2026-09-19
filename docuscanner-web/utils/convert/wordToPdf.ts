"use client";

// Word (.docx) -> PDF, entirely in the browser: mammoth reads the document,
// docxHtml.ts turns it into safe HTML, html-to-pdfmake maps that HTML to a
// document definition, and pdfmake lays it out as a real PDF (selectable text,
// working links, embedded images).
//
// It carries the common content and formatting of a Word document -- headings,
// paragraphs, bold/italic/underline/strikethrough, lists, tables, pictures,
// links, paragraph alignment and page breaks -- but is not a Word layout
// engine: fonts, colours, exact spacing, headers/footers, text boxes and
// floating objects are not reproduced.

import { checkDocxFile, docxToSafeHtml, WordConvertError } from "./docxHtml";

export type WordStage = "reading" | "converting" | "building";

export interface WordToPdfOptions {
  onStage?: (stage: WordStage) => void;
}

export interface WordToPdfResult {
  blob: Blob;
  warnings: string[];
}

// A4 with 56pt (about 2cm) margins.
const PAGE_MARGIN = 56;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;
const MAX_IMAGE_HEIGHT = 680;
const PX_TO_PT = 0.75;

interface PdfMakeLike {
  addVirtualFileSystem: (vfs: unknown) => void;
  setUrlAccessPolicy: (allow: (url: string) => boolean) => void;
  createPdf: (definition: unknown) => { getBlob: () => Promise<Blob> };
}

let pdfMakePromise: Promise<PdfMakeLike> | null = null;

// pdfmake and its fonts are large, so they load only when a Word file is
// actually converted, and only once.
function loadPdfMake(): Promise<PdfMakeLike> {
  if (!pdfMakePromise) {
    pdfMakePromise = Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")])
      .then(([mod, fonts]) => {
        const pdfMake = ((mod as { default?: unknown }).default ?? mod) as unknown as PdfMakeLike;
        const vfs = (fonts as { default?: unknown }).default ?? fonts;
        pdfMake.addVirtualFileSystem(vfs);
        // The document is untrusted: never let the PDF builder fetch anything
        // from the network (all pictures are embedded data already).
        pdfMake.setUrlAccessPolicy(() => false);
        return pdfMake;
      })
      .catch((error) => {
        pdfMakePromise = null;
        throw error;
      });
  }
  return pdfMakePromise;
}

// Sets each picture's size in the PDF: its natural size, scaled down to fit the
// page. (Word stores sizes separately from the image; mammoth doesn't carry them.)
async function sizeImages(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      try {
        const probe = new Image();
        probe.src = img.getAttribute("src") ?? "";
        await probe.decode();
        let w = probe.naturalWidth * PX_TO_PT;
        let h = probe.naturalHeight * PX_TO_PT;
        const scale = Math.min(1, CONTENT_WIDTH / w, MAX_IMAGE_HEIGHT / h);
        w *= scale;
        h *= scale;
        img.setAttribute("width", String(Math.max(1, Math.round(w))));
        img.setAttribute("height", String(Math.max(1, Math.round(h))));
      } catch {
        img.remove();
      }
    }),
  );
  return doc.body.innerHTML;
}

const TABLE_LAYOUT = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#b0b0b0",
  vLineColor: () => "#b0b0b0",
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

// Word tables usually have borders that mammoth can't read; a thin grid keeps
// them readable.
function decorate(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(decorate);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (record.table) record.layout = TABLE_LAYOUT;
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") decorate(value);
  }
}

export async function convertDocxToPdf(file: File, options: WordToPdfOptions = {}): Promise<WordToPdfResult> {
  options.onStage?.("reading");
  const buffer = await file.arrayBuffer();
  checkDocxFile(file, new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)));

  options.onStage?.("converting");
  const { html, warnings, hasContent } = await docxToSafeHtml(buffer);
  if (!hasContent) throw new WordConvertError("word_empty");
  const sized = await sizeImages(html);

  try {
    options.onStage?.("building");
    const [pdfMake, htmlToPdfMakeModule] = await Promise.all([loadPdfMake(), import("html-to-pdfmake")]);
    const htmlToPdfMake = ((htmlToPdfMakeModule as { default?: unknown }).default ?? htmlToPdfMakeModule) as unknown as (
      html: string,
      options: Record<string, unknown>,
    ) => unknown;

    const content = htmlToPdfMake(sized, {
      window,
      removeExtraBlanks: true,
      defaultStyles: {
        a: { color: "#1a56b8", decoration: "underline" },
      },
    });
    decorate(content);

    const definition = {
      pageSize: "A4",
      pageMargins: [PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN],
      info: { title: file.name.replace(/\.docx$/i, ""), creator: "DocuScanner" },
      defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.25 },
      content,
      styles: {
        "jc-center": { alignment: "center" },
        "jc-right": { alignment: "right" },
        "jc-justify": { alignment: "justify" },
      },
      pageBreakBefore: (node: { style?: unknown }) =>
        Array.isArray(node.style) && node.style.includes("page-break-before"),
    };

    const blob = await pdfMake.createPdf(definition).getBlob();
    return { blob, warnings };
  } catch (error) {
    if (error instanceof WordConvertError) throw error;
    throw new WordConvertError("word_failed");
  }
}
