"use client";

// Word (.docx) -> PDF, entirely in the browser.
//
// The heavy lifting is the layout engine in ./docx: it reads the document's
// real formatting (fonts, sizes, spacing, indents, tables, pictures, headers and
// footers, sections ...), lays it out with Word's own rules and draws a vector
// PDF with selectable text. It is checked against Microsoft Word's own PDF
// export on a set of fixtures (see tests/docx).
//
// Fonts: the browser has no Calibri/Arial/Times New Roman to embed, so open
// metric-compatible twins are used (Carlito, Arimo, Tinos, Cousine, Caladea):
// same character widths and line heights, so lines and pages break as in Word.
// Fonts with no twin (Aptos, Verdana, Segoe UI ...) can't be bundled. They are
// used from a real font file when there is one -- embedded in the document,
// added by the person, installed on their device or hosted by the site -- and
// otherwise the closest twin is used and the result says so.

import { checkDocxFile, WordConvertError } from "./wordErrors";
import { findHostedFonts, findInstalledFonts, getUserFonts } from "./userFonts";

export type WordStage = "reading" | "converting" | "building";

export interface WordToPdfOptions {
  onStage?: (stage: WordStage) => void;
}

export interface WordToPdfResult {
  blob: Blob;
  pageCount: number;
  warnings: string[];
  // Fonts the document uses that had no real font file (a look-alike was used).
  missingFonts: string[];
}

const FONT_BASE = "/fonts/docx";

// Loads one font file from the same origin. A missing script subset is normal
// (not every family covers every script), so that is not an error.
async function loadFont(family: string, subset: string, bold: boolean, italic: boolean): Promise<Uint8Array | null> {
  const url = `${FONT_BASE}/${family}-${subset}-${bold ? 700 : 400}-${italic ? "italic" : "normal"}.woff`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

// Pictures the PDF writer can't embed as-is (GIF, BMP, WebP, SVG ...) are
// redrawn through a canvas as PNG.
async function convertImage(data: Uint8Array, mime: string): Promise<{ data: Uint8Array; mime: string } | null> {
  if (!/^image\/(gif|bmp|webp|svg\+xml|tiff)$/.test(mime)) return null;
  try {
    const bitmap = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    return { data: new Uint8Array(await blob.arrayBuffer()), mime: "image/png" };
  } catch {
    return null;
  }
}

export async function convertDocxToPdf(file: File, options: WordToPdfOptions = {}): Promise<WordToPdfResult> {
  options.onStage?.("reading");
  const buffer = await file.arrayBuffer();
  checkDocxFile(file, new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)));

  // The engine (PDF writer, font parser, zip reader) is large, so it loads only
  // once a Word file is actually being converted.
  const engine = await import("./docx/index");

  try {
    const result = await engine.docxToPdf(buffer, {
      loadFont: loadFont as import("./docx/index").FontLoader,
      fontFiles: await getUserFonts(),
      findFonts: async (names) => [...(await findHostedFonts(names)), ...(await findInstalledFonts(names))],
      convertImage,
      title: file.name.replace(/\.docx$/i, ""),
      onStage: (stage) => options.onStage?.(stage === "reading" ? "reading" : stage === "layout" ? "converting" : "building"),
    });
    return {
      blob: new Blob([result.bytes as BlobPart], { type: "application/pdf" }),
      pageCount: result.pageCount,
      warnings: result.warnings,
      missingFonts: result.missingFonts,
    };
  } catch (error) {
    if (error instanceof engine.EmptyDocumentError) throw new WordConvertError("word_empty");
    if (error instanceof WordConvertError) throw error;
    // A file that opens as a zip but has no document part is not a Word file.
    if (error instanceof Error && /no document part|no body/.test(error.message)) throw new WordConvertError("word_invalid");
    throw new WordConvertError("word_failed");
  }
}
