"use client";

// Browser glue for Protect: loads the QPDF engine (served from this site, not a third
// party) for PDFs, turns a picture into a one-page PDF when needed, and runs the
// transaction in ./operation.ts. Nothing here makes a network request except fetching the
// PDF engine file itself; Word documents are encrypted with the browser's own Web Crypto.

import { ProtectError, MAX_PROTECT_BYTES, type ProtectOptions, type QpdfInstance } from "./protect.ts";
import { MAX_OFFICE_BYTES, officeExtensionOf, type OfficeExtension } from "./office.ts";
import { flatOpcToPackage, looksLikeFlatOpc, MAX_XML_BYTES } from "./flatOpc.ts";
import { runProtection, type ProtectHooks, type ProtectedOutput } from "./operation.ts";

export const QPDF_WASM_URL = "/qpdf/qpdf.wasm";

async function createQpdf(): Promise<QpdfInstance> {
  const { default: createModule } = await import("@neslinesli93/qpdf-wasm");
  // A fresh instance per file, so nothing from one file can linger for the next.
  // The engine prints progress to the console by default; nothing here should be logged.
  const silent = () => {};
  return (await createModule({ locateFile: () => QPDF_WASM_URL, noInitialRun: true, print: silent, printErr: silent } as never)) as unknown as QpdfInstance;
}

// "xml" is an Office XML Document that is converted to the package it describes before protection.
export type ProtectSourceKind = "pdf" | "office" | "xml" | "image";

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
// Office packages (Word, Excel, PowerPoint) are encrypted as they are; whether a file's
// contents really match its extension is checked in utils/protect/office.ts.
export function classifyProtectFile(file: File, head: Uint8Array, officeEnabled = true): ProtectSourceKind {
  const name = file.name.toLowerCase();
  if (officeEnabled && /\.(doc|xls|ppt)$/.test(name)) throw new ProtectError("protect_legacy_doc");
  const isPdfName = name.endsWith(".pdf");
  const isXmlName = officeEnabled && name.endsWith(".xml");
  const isOfficeName = officeEnabled && officeExtensionOf(name) !== null;
  const isImageName = /\.(jpe?g|png|webp)$/.test(name);
  if (!isPdfName && !isOfficeName && !isXmlName && !isImageName) throw new ProtectError("protect_unsupported_type");
  if (file.size === 0) throw new ProtectError("protect_invalid");
  if (file.size > (isXmlName ? MAX_XML_BYTES : isOfficeName ? MAX_OFFICE_BYTES : MAX_PROTECT_BYTES)) throw new ProtectError("protect_too_large");
  if (isPdfName) {
    if (!new TextDecoder("latin1").decode(head).includes("%PDF-")) throw new ProtectError("protect_invalid");
    return "pdf";
  }
  if (isOfficeName) return "office";
  if (isXmlName) {
    // Only an Office "XML Document" (Flat OPC) can be converted; the start of the file says which it is.
    if (!looksLikeFlatOpc(new TextDecoder("utf-8").decode(head))) throw new ProtectError("protect_xml_unsupported");
    return "xml";
  }
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
  // Whether the Office options (feature flag) are switched on.
  officeEnabled: boolean;
}

// The file is only ever read (File objects are immutable); the protected copy is new bytes.
export async function protectFile(request: ProtectFileRequest, hooks: ProtectHooks = {}): Promise<ProtectedOutput & { source: ProtectSourceKind }> {
  const { file } = request;
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  const source = classifyProtectFile(file, head, request.officeEnabled);
  let bytes: Uint8Array;
  let officeExtension: OfficeExtension | undefined;
  if (source === "xml") {
    // Rebuild the package the XML describes (lossless), then protect that.
    try {
      ({ bytes, extension: officeExtension } = await flatOpcToPackage(await file.text()));
    } catch (error) {
      if (error instanceof ProtectError) throw error;
      throw new ProtectError("protect_invalid");
    }
  } else if (source === "office") {
    bytes = new Uint8Array(await file.arrayBuffer());
    officeExtension = officeExtensionOf(file.name) ?? "docx";
  } else {
    bytes = source === "image" ? await imageToPdf(file) : new Uint8Array(await file.arrayBuffer());
  }
  const output = await runProtection({ kind: officeExtension ? "office" : "pdf", officeExtension, bytes, password: request.password, options: request.options }, { createQpdf }, hooks);
  return { ...output, source };
}

// Reads just enough of a chosen file to refuse a wrong or damaged one straight away.
export async function checkProtectFile(file: File, officeEnabled = true): Promise<ProtectSourceKind> {
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  const kind = classifyProtectFile(file, head, officeEnabled);
  if (kind === "office") {
    const { validateOfficePackage } = await import("./office.ts");
    await validateOfficePackage(new Uint8Array(await file.arrayBuffer()), officeExtensionOf(file.name) ?? "docx");
  } else if (kind === "pdf") {
    // A quick look for an existing password in the ends of the file, where the trailer lives;
    // the PDF is not parsed (that costs several times its size in memory) unless something is
    // found. Damaged files are left for the protect step to report.
    const { isEncryptedPdf, mentionsEncrypt, SCAN_BYTES } = await import("./protect.ts");
    const ends =
      file.size <= 2 * SCAN_BYTES
        ? new Uint8Array(await file.arrayBuffer())
        : new Uint8Array(await new Blob([file.slice(0, SCAN_BYTES), file.slice(file.size - SCAN_BYTES)]).arrayBuffer());
    if (mentionsEncrypt(ends) && (await isEncryptedPdf(new Uint8Array(await file.arrayBuffer())))) throw new ProtectError("protect_already_protected");
  }
  return kind;
}
