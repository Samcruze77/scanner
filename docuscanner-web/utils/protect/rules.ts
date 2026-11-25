// The parts of password protection that the page needs before any file is protected: the error
// type, the limits, the password rules, the default options and the download name. Nothing here
// touches a file or loads an engine, so the Protect page can show its form and messages without
// downloading pdf-lib, QPDF or the Office encryption code; those load when protection starts
// (utils/protect/browser.ts). protect.ts and operation.ts re-export everything here, so existing
// imports keep working.

import { fileBaseName } from "../files/filename.ts";

export type ProtectErrorCode =
  | "protect_unsupported_type"
  | "protect_too_large"
  | "protect_invalid"
  | "protect_already_protected"
  | "protect_password_missing"
  | "protect_password_short"
  | "protect_password_long"
  | "protect_password_mismatch"
  | "protect_type_mismatch"
  | "protect_legacy_doc"
  | "protect_xml_unsupported"
  | "protect_cancelled"
  | "protect_timeout"
  | "protect_memory"
  | "protect_unverified"
  | "protect_unsupported_browser"
  | "protect_failed";

export class ProtectError extends Error {
  readonly code: ProtectErrorCode;
  constructor(code: ProtectErrorCode) {
    super(code);
    this.name = "ProtectError";
    this.code = code;
  }
}

export const MAX_PROTECT_BYTES = 100 * 1024 * 1024;
export const MIN_PASSWORD_LENGTH = 6;
// The PDF standard allows at most 127 bytes (UTF-8) for an AES-256 password.
export const MAX_PASSWORD_BYTES = 127;

export interface ProtectOptions {
  // Needed to open the PDF.
  password: string;
  // What people who open it may do. These are requests that PDF readers honour;
  // they do not stop someone who has the password from reading the file.
  allowPrint: boolean;
  allowCopy: boolean;
  allowEdit: boolean;
}

export const DEFAULT_PROTECT_OPTIONS: Omit<ProtectOptions, "password"> = {
  allowPrint: true,
  allowCopy: true,
  allowEdit: false,
};

// The slice of the QPDF WebAssembly module that is used.
export interface QpdfInstance {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
}
export type QpdfFactory = () => Promise<QpdfInstance>;

// "" when fine, otherwise the error code. Used by the form and re-checked by protectPdf.
export function validatePassword(password: string, confirm?: string): ProtectErrorCode | "" {
  if (password.length === 0) return "protect_password_missing";
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) return "protect_password_short";
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return "protect_password_long";
  if (confirm !== undefined && confirm !== password) return "protect_password_mismatch";
  return "";
}

// "Q3 report.pdf" -> "Q3 report-protected.pdf".
export function protectedFilename(inputName: string): string {
  return `${fileBaseName(inputName, "document")}-protected.pdf`;
}

export type ProtectPhase = "validating" | "encrypting" | "verifying" | "completed";

// Any failure as a ProtectError the page can explain: running out of memory is told apart,
// everything unexpected is "protect_failed".
export function toProtectError(error: unknown): ProtectError {
  if (error instanceof ProtectError) return error;
  const name = (error as { name?: string } | null)?.name;
  const message = String((error as { message?: string } | null)?.message ?? "");
  if (error instanceof RangeError || name === "QuotaExceededError" || /out of memory|allocation|Array buffer allocation/i.test(message)) return new ProtectError("protect_memory");
  return new ProtectError("protect_failed");
}
