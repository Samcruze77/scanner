// Password-protect a PDF. Runs entirely on the device: the PDF and the password
// go into QPDF (a real PDF library, compiled to WebAssembly) in this browser tab
// and never to any server. QPDF writes standard PDF encryption (AES-256, PDF 2.0
// / revision 6), so any normal PDF reader asks for the password before showing
// the file.
//
// Dependency-free of the browser: the caller supplies the QPDF instance (see
// ./browser.ts), so the same code runs in Node for the tests.

import { PDFDocument } from "pdf-lib";

export type ProtectErrorCode =
  | "protect_unsupported_type"
  | "protect_too_large"
  | "protect_invalid"
  | "protect_already_protected"
  | "protect_password_missing"
  | "protect_password_short"
  | "protect_password_long"
  | "protect_password_mismatch"
  | "protect_macro_unsupported"
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

// A random password nobody sees. QPDF gives whoever opens the file with the
// owner password full rights, so when it equals the open password the permission
// choices would mean nothing.
function randomOwnerPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The QPDF command-line arguments for these options (exported so tests can check
// the exact permissions requested).
export function encryptArgs(options: ProtectOptions, ownerPassword: string): string[] {
  return [
    "--encrypt",
    options.password,
    ownerPassword,
    "256",
    `--print=${options.allowPrint ? "full" : "none"}`,
    `--extract=${options.allowCopy ? "y" : "n"}`,
    `--modify=${options.allowEdit ? "all" : "none"}`,
    "--",
  ];
}

function run(qpdf: QpdfInstance, args: string[]): number {
  try {
    return qpdf.callMain(args);
  } catch (error) {
    // Emscripten reports a non-zero exit by throwing an object with `status`.
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : 2;
  }
}

function cleanup(qpdf: QpdfInstance, paths: string[]) {
  for (const path of paths) {
    try {
      qpdf.FS.unlink(path);
    } catch {
      // Already gone.
    }
  }
}

// True when the PDF already has any encryption (a password to open it, or only
// restrictions on what can be done with it).
async function isEncrypted(data: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false });
    return false;
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    const message = (error as { message?: string } | null)?.message ?? "";
    return name === "EncryptedPDFError" || /encrypt/i.test(message);
  }
}

function startsWithPdfHeader(data: Uint8Array): boolean {
  // The header may follow a few junk bytes; readers accept it within the first 1 KB.
  const head = new TextDecoder("latin1").decode(data.subarray(0, 1024));
  return head.includes("%PDF-");
}

export interface ProtectResult {
  data: Uint8Array;
  originalBytes: number;
  protectedBytes: number;
}

export async function protectPdf(input: Uint8Array, options: ProtectOptions, createQpdf: QpdfFactory): Promise<ProtectResult> {
  const passwordError = validatePassword(options.password);
  if (passwordError) throw new ProtectError(passwordError);
  if (input.byteLength === 0 || !startsWithPdfHeader(input)) throw new ProtectError("protect_invalid");
  if (input.byteLength > MAX_PROTECT_BYTES) throw new ProtectError("protect_too_large");
  if (await isEncrypted(input)) throw new ProtectError("protect_already_protected");

  let qpdf: QpdfInstance;
  try {
    qpdf = await createQpdf();
  } catch {
    throw new ProtectError("protect_failed");
  }

  const files = ["/in.pdf", "/out.pdf"];
  try {
    qpdf.FS.writeFile("/in.pdf", input);
    // 0 = fine, 3 = written with warnings (a damaged file that QPDF repaired).
    const rc = run(qpdf, [...encryptArgs(options, randomOwnerPassword()), "/in.pdf", "/out.pdf"]);
    if (rc !== 0 && rc !== 3) throw new ProtectError("protect_invalid");

    const output = qpdf.FS.readFile("/out.pdf");
    // Never hand back a file we have not proven is locked: it must open with the
    // password, and must NOT open without one.
    const opensWithPassword = [0, 3].includes(run(qpdf, ["--check", `--password=${options.password}`, "/out.pdf"]));
    const opensWithoutPassword = run(qpdf, ["--show-encryption", "/out.pdf"]) === 0;
    if (!opensWithPassword || opensWithoutPassword || !(await isEncrypted(output))) throw new ProtectError("protect_failed");

    // Copy out of the WebAssembly memory before it is released.
    const data = new Uint8Array(output);
    return { data, originalBytes: input.byteLength, protectedBytes: data.byteLength };
  } catch (error) {
    if (error instanceof ProtectError) throw error;
    throw new ProtectError("protect_failed");
  } finally {
    cleanup(qpdf, files);
  }
}

// "Q3 report.pdf" -> "Q3 report-protected.pdf".
export function protectedFilename(inputName: string): string {
  const base = inputName
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\- .()]+/g, "_")
    .trim();
  return `${base || "document"}-protected.pdf`;
}
