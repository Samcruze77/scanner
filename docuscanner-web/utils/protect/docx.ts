// Input checks for Word protection: is this really an ordinary, unencrypted Word package of
// the kind its file name says? Accepted: .docx (document), .docm (macro-enabled document),
// .dotx (template) and .dotm (macro-enabled template). They are all the same kind of package,
// so the same Office encryption applies to each.
//
// The package is encrypted exactly as it is. Macros are never run, changed or removed.
// A file's contents must match its extension: a macro-enabled document saved under a plain
// .docx name is refused, so macro content can never pass as an ordinary document.
// Legacy .doc files and files that are already encrypted are refused.

import { CFB_MAGIC } from "./ooxml.ts";
import { ProtectError } from "./protect.ts";

export const MAX_DOCX_BYTES = 50 * 1024 * 1024;

export type WordExtension = "docx" | "docm" | "dotx" | "dotm";
export const WORD_EXTENSIONS: readonly WordExtension[] = ["docx", "docm", "dotx", "dotm"];

// The content type of the main document part that identifies each kind of package.
const MAIN_PART: Record<WordExtension, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  docm: "application/vnd.ms-word.document.macroEnabled.main+xml",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  dotm: "application/vnd.ms-word.template.macroEnabled.main+xml",
};

export const WORD_MIME: Record<WordExtension, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  dotm: "application/vnd.ms-word.template.macroEnabled.12",
};

export function wordExtensionOf(fileName: string): WordExtension | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return (WORD_EXTENSIONS as readonly string[]).includes(ext ?? "") ? (ext as WordExtension) : null;
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

export async function validateDocxPackage(bytes: Uint8Array, extension: WordExtension = "docx"): Promise<void> {
  if (bytes.length === 0) throw new ProtectError("protect_invalid");
  if (bytes.length > MAX_DOCX_BYTES) throw new ProtectError("protect_too_large");

  // An OLE container is either a Word file that already has a password, or an old .doc.
  if (startsWith(bytes, CFB_MAGIC)) {
    throw new ProtectError(hasEncryptedPackage(bytes) ? "protect_already_protected" : "protect_legacy_doc");
  }
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) throw new ProtectError("protect_invalid");

  let contentTypes: string | undefined;
  let hasDocument = false;
  let hasMacros = false;
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    contentTypes = await zip.file("[Content_Types].xml")?.async("string");
    hasDocument = Boolean(zip.file("word/document.xml"));
    hasMacros = Boolean(zip.file("word/vbaProject.bin"));
  } catch {
    throw new ProtectError("protect_invalid");
  }
  if (!contentTypes || !hasDocument) throw new ProtectError("protect_invalid");

  // Which kind of Word package is it really? Exactly one main-part type must be declared.
  const declared = WORD_EXTENSIONS.filter((e) => contentTypes!.includes(MAIN_PART[e]));
  if (declared.length !== 1) throw new ProtectError(declared.length === 0 ? "protect_invalid" : "protect_type_mismatch");
  // It must be the kind the file name claims, and macro code may only travel in macro-enabled types.
  if (declared[0] !== extension) throw new ProtectError("protect_type_mismatch");
  if (hasMacros && extension !== "docm" && extension !== "dotm") throw new ProtectError("protect_type_mismatch");
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
