"use client";

// Browser glue for Protect: loads the QPDF engine (served from this site, not a third
// party) for PDFs, turns a picture into a one-page PDF when needed, and runs the
// transaction in ./operation.ts. Nothing here makes a network request except fetching the
// PDF engine file itself; Word documents are encrypted with the browser's own Web Crypto.

import { ProtectError, MAX_PROTECT_BYTES, type ProtectOptions, type QpdfInstance } from "./protect.ts";
import { MAX_DOCX_BYTES } from "./docx.ts";
import { runProtection, type ProtectHooks, type ProtectedOutput } from "./operation.ts";

export const QPDF_WASM_URL = "/qpdf/qpdf.wasm";

async function createQpdf(): Promise<QpdfInstance> {
  const { default: createModule } = await import("@neslinesli93/qpdf-wasm");
  // A fresh instance per file, so nothing from one file can linger for the next.
  // The engine prints progress to the console by default; nothing here should be logged.
  const silent = () => {};
  return (await createModule({ locateFile: () => QPDF_WASM_URL, noInitialRun: true, print: silent, printErr: silent } as never)) as unknown as QpdfInstance;
}

export type ProtectSourceKind = "pdf" | "docx" | "image";

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

function isImage(head: Uint8Array): boolean {
  return (
    startsWith(head, [0xff, 0xd8, 0xff]) ||
    startsWith(head, [0x89, 0x50, 0x4e, 0x47]) ||
    (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50)
  );
}

// Checks the extension, size and real file signature before doing any work, so a
// renamed or damaged file gets a clear message instead of a stalled spinner.
// `.docm` (macros) is refused on purpose: it is never treated as an ordinary .docx.
export function classifyProtectFile(file: File, head: Uint8Array, wordEnabled = true): ProtectSourceKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docm")) throw new ProtectError("protect_macro_unsupported");
  const isPdfName = name.endsWith(".pdf");
  const isDocxName = wordEnabled && name.endsWith(".docx");
  const isImageName = /\.(jpe?g|png|webp)$/.test(name);
  if (!isPdfName && !isDocxName && !isImageName) throw new ProtectError("protect_unsupported_type");
  if (file.size === 0) throw new ProtectError("protect_invalid");
  if (file.size > (isDocxName ? MAX_DOCX_BYTES : MAX_PROTECT_BYTES)) throw new ProtectError("protect_too_large");
  if (isPdfName) {
    if (!new TextDecoder("latin1").decode(head).includes("%PDF-")) throw new ProtectError("protect_invalid");
    return "pdf";
  }
  if (isDocxName) return "docx";
  if (!isImage(head)) throw new ProtectError("protect_invalid");
  return "image";
}

// A picture becomes a one-page PDF (A4 at most, aspect ratio kept) that is then protected.
async function imageToPdf(file: File): Promise<Uint8Array> {
  const [{ PDFDocument }, { fileToCapturedImage }] = await Promise.all([import("pdf-lib"), import("@/utils/scanner/image")]);
  let captured;
  try {
    captured = await fileToCapturedImage(file);
  } catch {
    throw new ProtectError("protect_invalid");
  }
  const jpeg = await (await fetch(captured.dataUrl)).arrayBuffer();
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(jpeg);
  const [maxWidth, maxHeight] = image.width > image.height ? [841.89, 595.28] : [595.28, 841.89];
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  return await pdf.save();
}

export interface ProtectFileRequest {
  file: File;
  password: string;
  options: Omit<ProtectOptions, "password">;
  wordEnabled: boolean;
}

// The file is only ever read (File objects are immutable); the protected copy is new bytes.
export async function protectFile(request: ProtectFileRequest, hooks: ProtectHooks = {}): Promise<ProtectedOutput & { source: ProtectSourceKind }> {
  const { file } = request;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const source = classifyProtectFile(file, head, request.wordEnabled);
  const bytes = source === "image" ? await imageToPdf(file) : new Uint8Array(await file.arrayBuffer());
  const output = await runProtection({ kind: source === "docx" ? "docx" : "pdf", bytes, password: request.password, options: request.options }, { createQpdf }, hooks);
  return { ...output, source };
}

// Reads just enough of a chosen file to refuse a wrong or damaged one straight away.
export async function checkProtectFile(file: File, wordEnabled = true): Promise<ProtectSourceKind> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const kind = classifyProtectFile(file, head, wordEnabled);
  if (kind === "docx") {
    const { validateDocxPackage } = await import("./docx.ts");
    await validateDocxPackage(new Uint8Array(await file.arrayBuffer()));
  } else if (kind === "pdf") {
    const { PDFDocument } = await import("pdf-lib");
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      const message = (error as { message?: string } | null)?.message ?? "";
      if (name === "EncryptedPDFError" || /encrypt/i.test(message)) throw new ProtectError("protect_already_protected");
      // pdf-lib is stricter than QPDF, which repairs many damaged files: let protectPdf decide.
    }
  }
  return kind;
}
