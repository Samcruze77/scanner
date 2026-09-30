// Input checks for Word (.docx) protection: is this really an ordinary, unencrypted
// .docx package? Only that is accepted. Macro-enabled documents (.docm), templates,
// legacy .doc files and already-encrypted files are refused, never converted or
// stripped.

import { CFB_MAGIC } from "./ooxml.ts";
import { ProtectError } from "./protect.ts";

export const MAX_DOCX_BYTES = 50 * 1024 * 1024;

const MAIN_DOCUMENT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

export async function validateDocxPackage(bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) throw new ProtectError("protect_invalid");
  if (bytes.length > MAX_DOCX_BYTES) throw new ProtectError("protect_too_large");

  // An OLE container is either a Word file that already has a password, or an old .doc.
  if (startsWith(bytes, CFB_MAGIC)) {
    throw new ProtectError(hasEncryptedPackage(bytes) ? "protect_already_protected" : "protect_unsupported_type");
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
  if (hasMacros || /macroEnabled/i.test(contentTypes)) throw new ProtectError("protect_macro_unsupported");
  if (!contentTypes.includes(MAIN_DOCUMENT)) throw new ProtectError("protect_unsupported_type");
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
