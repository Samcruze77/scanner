// Password-protect a PDF. Runs entirely on the device: the PDF and the password
// go into QPDF (a real PDF library, compiled to WebAssembly) in this browser tab
// and never to any server. QPDF writes standard PDF encryption (AES-256, PDF 2.0
// / revision 6), so any normal PDF reader asks for the password before showing
// the file.
//
// Dependency-free of the browser: the caller supplies the QPDF instance (see
// ./browser.ts), so the same code runs in Node for the tests.

import { PDFDocument } from "pdf-lib";

// The error type, limits, password rules and options live in rules.ts (no pdf-lib), so the page can
// use them without loading the engine; re-exported here for existing callers and tests.
import { MAX_PROTECT_BYTES, ProtectError, validatePassword, type ProtectOptions, type QpdfFactory, type QpdfInstance } from "./rules.ts";
export { DEFAULT_PROTECT_OPTIONS, MAX_PASSWORD_BYTES, MAX_PROTECT_BYTES, MIN_PASSWORD_LENGTH, protectedFilename, ProtectError, validatePassword } from "./rules.ts";
export type { ProtectErrorCode, ProtectOptions, QpdfFactory, QpdfInstance } from "./rules.ts";

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

// A cheap look for the word /Encrypt in the first and last megabyte of a PDF, where the
// trailer (or the xref stream dictionary, or a linearized file's first-page trailer) that
// carries it lives. Much cheaper than parsing the whole file: a 100 MB PDF parsed by pdf-lib
// costs several times its size in memory.
export const SCAN_BYTES = 1024 * 1024;
const ENCRYPT = new TextEncoder().encode("/Encrypt");
export function mentionsEncrypt(data: Uint8Array): boolean {
  const scan = (from: number, to: number) => {
    const last = to - ENCRYPT.length;
    outer: for (let i = from; i <= last; i++) {
      if (data[i] !== ENCRYPT[0]) continue;
      for (let j = 1; j < ENCRYPT.length; j++) if (data[i + j] !== ENCRYPT[j]) continue outer;
      return true;
    }
    return false;
  };
  return scan(0, Math.min(data.length, SCAN_BYTES)) || scan(Math.max(0, data.length - SCAN_BYTES), data.length);
}

// Whether the PDF parser itself says the file is encrypted (slow and memory-hungry on big
// files, so only used to confirm a hit or to explain a failure).
async function parserSaysEncrypted(data: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false });
    return false;
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    const message = (error as { message?: string } | null)?.message ?? "";
    return name === "EncryptedPDFError" || /encrypt/i.test(message);
  }
}

// True when the PDF already has any encryption (a password to open it, or only restrictions
// on what can be done with it). Files that never mention /Encrypt near their ends are not
// parsed at all.
export async function isEncryptedPdf(data: Uint8Array): Promise<boolean> {
  return mentionsEncrypt(data) && (await parserSaysEncrypted(data));
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
  if (await isEncryptedPdf(input)) throw new ProtectError("protect_already_protected");

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
    if (rc !== 0 && rc !== 3) {
      // Unreadable, or protected with an open password that the quick scan above missed:
      // the slow parser is only used here, to give the right explanation.
      throw new ProtectError((await parserSaysEncrypted(input)) ? "protect_already_protected" : "protect_invalid");
    }
    // The engine's copy of the input is no longer needed: free it before the checks.
    cleanup(qpdf, ["/in.pdf"]);

    // Never hand back a file we have not proven is locked: it must open with the password,
    // and must NOT open without one. These commands are chosen because they print nothing
    // secret (QPDF's --check and --show-encryption print "User password = ..." to the console).
    //   --requires-password exits 3 only for an encrypted file that the supplied password opens
    //   (2 for a wrong or missing password, and also for an unencrypted file).
    const pw = `--password=${options.password}`;
    const opensWithPassword = run(qpdf, ["--requires-password", pw, "/out.pdf"]) === 3 && run(qpdf, ["--show-npages", pw, "/out.pdf"]) === 0;
    const opensWithoutPassword = run(qpdf, ["--requires-password", "/out.pdf"]) === 3 || run(qpdf, ["--show-npages", "/out.pdf"]) === 0;
    // readFile returns a copy that stays valid after the engine's file is deleted.
    const data = qpdf.FS.readFile("/out.pdf");
    if (!opensWithPassword || opensWithoutPassword || data.byteLength === 0 || !mentionsEncrypt(data)) throw new ProtectError("protect_failed");
    return { data, originalBytes: input.byteLength, protectedBytes: data.byteLength };
  } catch (error) {
    if (error instanceof ProtectError) throw error;
    throw new ProtectError("protect_failed");
  } finally {
    cleanup(qpdf, files);
  }
}
