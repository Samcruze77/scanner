// Input checks for Office protection: is this really an ordinary, unencrypted Office package of
// the kind its file name says it is?
//
// Word, Excel and PowerPoint files from Office 2007 on are all the same kind of package (a ZIP
// of XML parts), so the same Office encryption applies to each:
//   Word        .docx .docm .dotx .dotm
//   Excel       .xlsx .xlsm .xltx .xltm .xlsb
//   PowerPoint  .pptx .pptm .potx .potm .ppsx .ppsm
//
// The package is encrypted exactly as it is. Macros are never run, changed or removed.
// A file's contents must match its extension: a macro-enabled file saved under a plain name
// (for example a .docm called .docx), or macro code inside a non-macro type, is refused, so
// macro content can never pass as an ordinary document. Legacy binary files (.doc, .xls,
// .ppt) and files that are already encrypted are refused.

import { CFB_MAGIC } from "./ooxml.ts";
import { ProtectError } from "./protect.ts";

export const MAX_OFFICE_BYTES = 50 * 1024 * 1024;

export type OfficeApp = "word" | "excel" | "powerpoint";
export type OfficeExtension =
  | "docx" | "docm" | "dotx" | "dotm"
  | "xlsx" | "xlsm" | "xltx" | "xltm" | "xlsb"
  | "pptx" | "pptm" | "potx" | "potm" | "ppsx" | "ppsm";

interface OfficeType {
  app: OfficeApp;
  macro: boolean;
  // The content type that marks the package's main part (the document, workbook or presentation).
  mainContentType: string;
  // That main part's path in the package.
  mainPart: string;
  mime: string;
}

const OOXML = "application/vnd.openxmlformats-officedocument";
const word = (macro: boolean, content: string, mime: string): OfficeType => ({ app: "word", macro, mainContentType: content, mainPart: "word/document.xml", mime });
const excel = (macro: boolean, content: string, mime: string, mainPart = "xl/workbook.xml"): OfficeType => ({ app: "excel", macro, mainContentType: content, mainPart, mime });
const ppt = (macro: boolean, content: string, mime: string): OfficeType => ({ app: "powerpoint", macro, mainContentType: content, mainPart: "ppt/presentation.xml", mime });

export const OFFICE_TYPES: Record<OfficeExtension, OfficeType> = {
  docx: word(false, `${OOXML}.wordprocessingml.document.main+xml`, `${OOXML}.wordprocessingml.document`),
  docm: word(true, "application/vnd.ms-word.document.macroEnabled.main+xml", "application/vnd.ms-word.document.macroEnabled.12"),
  dotx: word(false, `${OOXML}.wordprocessingml.template.main+xml`, `${OOXML}.wordprocessingml.template`),
  dotm: word(true, "application/vnd.ms-word.template.macroEnabled.main+xml", "application/vnd.ms-word.template.macroEnabled.12"),
  xlsx: excel(false, `${OOXML}.spreadsheetml.sheet.main+xml`, `${OOXML}.spreadsheetml.sheet`),
  xlsm: excel(true, "application/vnd.ms-excel.sheet.macroEnabled.main+xml", "application/vnd.ms-excel.sheet.macroEnabled.12"),
  xltx: excel(false, `${OOXML}.spreadsheetml.template.main+xml`, `${OOXML}.spreadsheetml.template`),
  xltm: excel(true, "application/vnd.ms-excel.template.macroEnabled.main+xml", "application/vnd.ms-excel.template.macroEnabled.12"),
  xlsb: excel(true, "application/vnd.ms-excel.sheet.binary.macroEnabled.main", "application/vnd.ms-excel.sheet.binary.macroEnabled.12", "xl/workbook.bin"),
  pptx: ppt(false, `${OOXML}.presentationml.presentation.main+xml`, `${OOXML}.presentationml.presentation`),
  pptm: ppt(true, "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml", "application/vnd.ms-powerpoint.presentation.macroEnabled.12"),
  potx: ppt(false, `${OOXML}.presentationml.template.main+xml`, `${OOXML}.presentationml.template`),
  potm: ppt(true, "application/vnd.ms-powerpoint.template.macroEnabled.main+xml", "application/vnd.ms-powerpoint.template.macroEnabled.12"),
  ppsx: ppt(false, `${OOXML}.presentationml.slideshow.main+xml`, `${OOXML}.presentationml.slideshow`),
  ppsm: ppt(true, "application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml", "application/vnd.ms-powerpoint.slideshow.macroEnabled.12"),
};

export const OFFICE_EXTENSIONS = Object.keys(OFFICE_TYPES) as OfficeExtension[];

export const OFFICE_APP_NOUN: Record<OfficeApp, string> = { word: "Word document", excel: "Excel workbook", powerpoint: "PowerPoint presentation" };

export function officeExtensionOf(fileName: string): OfficeExtension | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return ext && ext in OFFICE_TYPES ? (ext as OfficeExtension) : null;
}

export function officeAppOf(fileName: string): OfficeApp | null {
  const ext = officeExtensionOf(fileName);
  return ext ? OFFICE_TYPES[ext].app : null;
}

// Which kind of Office package does this [Content_Types].xml describe? null when it declares
// none of them, "ambiguous" when it declares more than one.
export function detectOfficeExtension(contentTypes: string): OfficeExtension | "ambiguous" | null {
  const declared = OFFICE_EXTENSIONS.filter((e) => contentTypes.includes(OFFICE_TYPES[e].mainContentType));
  return declared.length === 0 ? null : declared.length === 1 ? declared[0] : "ambiguous";
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

export async function validateOfficePackage(bytes: Uint8Array, extension: OfficeExtension = "docx"): Promise<void> {
  if (bytes.length === 0) throw new ProtectError("protect_invalid");
  if (bytes.length > MAX_OFFICE_BYTES) throw new ProtectError("protect_too_large");

  // An OLE container is either an Office file that already has a password, or an old binary file.
  if (startsWith(bytes, CFB_MAGIC)) {
    throw new ProtectError(hasEncryptedPackage(bytes) ? "protect_already_protected" : "protect_legacy_doc");
  }
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) throw new ProtectError("protect_invalid");

  const expected = OFFICE_TYPES[extension];
  let contentTypes: string | undefined;
  let hasMainPart = false;
  let hasMacros = false;
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    hasMainPart = Boolean(zip.file(expected.mainPart));
    hasMacros = Object.keys(zip.files).some((name) => /(^|\/)vbaProject\.bin$/i.test(name));
  } catch {
    throw new ProtectError("protect_invalid");
  }
  if (!contentTypes) throw new ProtectError("protect_invalid");

  // Exactly one main-part type must be declared, and it must be the one the file name claims.
  const actual = detectOfficeExtension(contentTypes);
  if (actual === null) throw new ProtectError("protect_invalid");
  if (actual === "ambiguous" || actual !== extension) throw new ProtectError("protect_type_mismatch");
  if (!hasMainPart) throw new ProtectError("protect_invalid");
  // Macro code may only travel in macro-enabled types.
  if (hasMacros && !expected.macro) throw new ProtectError("protect_type_mismatch");
}

// The directory of a container is at the end of the file for small ones, but its
// position varies, so look for the stream name anywhere in the first 8 MB.
function hasEncryptedPackage(bytes: Uint8Array): boolean {
  const needle = new TextEncoder().encode("E\0n\0c\0r\0y\0p\0t\0e\0d\0P\0a\0c\0k\0a\0g\0e\0");
  const limit = Math.min(bytes.length, 8 * 1024 * 1024) - needle.length;
  outer: for (let i = 0; i < limit; i++) {
    if (bytes[i] !== needle[0]) continue;
    for (let j = 1; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
