// Errors and file checks for the Word converters. Codes are what reach
// analytics (trackError), so they must never contain filenames or content.

export const MAX_DOCX_BYTES = 15 * 1024 * 1024;

export type WordErrorCode =
  | "word_unsupported_type"
  | "word_legacy_doc"
  | "word_too_large"
  | "word_invalid"
  | "word_unreadable"
  | "word_empty"
  | "word_failed";

export class WordConvertError extends Error {
  readonly code: WordErrorCode;
  constructor(code: WordErrorCode) {
    super(code);
    this.name = "WordConvertError";
    this.code = code;
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

// Called before parsing anything: right extension, sane size, and the bytes
// really are a zip container (a .docx is one).
export function checkDocxFile(file: File, head: Uint8Array): void {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc")) throw new WordConvertError("word_legacy_doc");
  if (!name.endsWith(".docx")) throw new WordConvertError("word_unsupported_type");
  if (file.size > MAX_DOCX_BYTES) throw new WordConvertError("word_too_large");
  // Old .doc files, and password-protected documents of any age, are OLE
  // containers rather than zip files.
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) throw new WordConvertError("word_legacy_doc");
  if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04])) throw new WordConvertError("word_invalid");
}
