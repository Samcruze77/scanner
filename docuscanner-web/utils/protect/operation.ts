// Protecting a document as one transaction:
//
//   validating -> encrypting -> verifying -> completed        (or failed / cancelled)
//
// The result is only ever returned after it has passed verification. Every failure,
// cancellation and timeout throws a ProtectError with a generic code and returns NO data,
// so nothing partial can be offered for download. The input bytes are never modified
// (they are only read). No state outlives the call, and the password is never logged or
// put in an error.
//
// Framework-free and browser-free (the QPDF engine is injected) so the tests run this exact code.

import { protectPdf, ProtectError, validatePassword, MAX_PROTECT_BYTES, type ProtectOptions, type QpdfFactory } from "./protect.ts";
import { encryptDocx, verifyEncryptedDocx } from "./ooxml.ts";
import { OFFICE_TYPES, validateOfficePackage, type OfficeExtension } from "./office.ts";

export type ProtectKind = "pdf" | "office";
export type ProtectPhase = "validating" | "encrypting" | "verifying" | "completed";

export interface ProtectRequest {
  kind: ProtectKind;
  // For Office files: the kind of package the file is said to be (default .docx).
  officeExtension?: OfficeExtension;
  // Read only. Never written to.
  bytes: Uint8Array;
  password: string;
  options: Omit<ProtectOptions, "password">;
}

export interface ProtectEngines {
  createQpdf: QpdfFactory;
  // Replaceable in tests to simulate failures.
  encryptDocx?: typeof encryptDocx;
  verifyEncryptedDocx?: typeof verifyEncryptedDocx;
}

export interface ProtectHooks {
  signal?: AbortSignal;
  onPhase?: (phase: ProtectPhase) => void;
  // 0..1 within the current phase.
  onProgress?: (fraction: number) => void;
  // Give up (and report protect_timeout) after this long. Default 5 minutes.
  timeoutMs?: number;
}

export interface ProtectedOutput {
  data: Uint8Array;
  mime: string;
  extension: "pdf" | OfficeExtension;
}

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Anything that is not already a ProtectError becomes a generic one; out-of-memory
// failures get their own message. Raw messages never reach the user.
export function toProtectError(error: unknown): ProtectError {
  if (error instanceof ProtectError) return error;
  const name = (error as { name?: string } | null)?.name;
  const message = String((error as { message?: string } | null)?.message ?? "");
  if (error instanceof RangeError || name === "QuotaExceededError" || /out of memory|allocation|Array buffer allocation/i.test(message)) return new ProtectError("protect_memory");
  return new ProtectError("protect_failed");
}

export async function runProtection(request: ProtectRequest, engines: ProtectEngines, hooks: ProtectHooks = {}): Promise<ProtectedOutput> {
  const controller = new AbortController();
  const outer = hooks.signal;
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  outer?.addEventListener("abort", onOuterAbort);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, hooks.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Resolves to a rejection the moment the operation is cancelled or times out, so the
  // caller is released even while a step that cannot be interrupted is still running.
  let release: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    const fail = () => reject(new ProtectError(timedOut ? "protect_timeout" : "protect_cancelled"));
    if (controller.signal.aborted) fail();
    controller.signal.addEventListener("abort", fail, { once: true });
    release = () => controller.signal.removeEventListener("abort", fail);
  });
  interrupted.catch(() => {});

  const signal = controller.signal;
  const phase = (p: ProtectPhase) => {
    if (signal.aborted) throw new ProtectError(timedOut ? "protect_timeout" : "protect_cancelled");
    hooks.onPhase?.(p);
  };

  const work = (async (): Promise<ProtectedOutput> => {
    try {
      // VALIDATING: nothing is encrypted until the inputs are good.
      phase("validating");
      const passwordError = validatePassword(request.password);
      if (passwordError) throw new ProtectError(passwordError);
      if (request.bytes.length === 0) throw new ProtectError("protect_invalid");
      if (request.kind === "office") await validateOfficePackage(request.bytes, request.officeExtension ?? "docx");
      else if (request.bytes.length > MAX_PROTECT_BYTES) throw new ProtectError("protect_too_large");

      if (request.kind === "office") {
        phase("encrypting");
        const encrypt = engines.encryptDocx ?? encryptDocx;
        const { data } = await encrypt(request.bytes, request.password, { signal, onProgress: hooks.onProgress });
        phase("verifying");
        const verify = engines.verifyEncryptedDocx ?? verifyEncryptedDocx;
        await verify(data, request.bytes, request.password, { signal, onProgress: hooks.onProgress });
        phase("completed");
        const extension = request.officeExtension ?? "docx";
        return { data, mime: OFFICE_TYPES[extension].mime, extension };
      }

      phase("encrypting");
      // protectPdf proves the output opens with the password and not without it.
      const { data } = await protectPdf(request.bytes, { ...request.options, password: request.password }, engines.createQpdf);
      phase("verifying");
      if (data.length === 0 || data.length === request.bytes.length && data.every((b, i) => b === request.bytes[i])) throw new ProtectError("protect_unverified");
      phase("completed");
      return { data, mime: "application/pdf", extension: "pdf" };
    } catch (error) {
      throw signal.aborted ? new ProtectError(timedOut ? "protect_timeout" : "protect_cancelled") : toProtectError(error);
    }
  })();

  try {
    const result = await Promise.race([work, interrupted]);
    // Belt and braces: a cancellation that arrived as the work finished still wins.
    if (signal.aborted) throw new ProtectError(timedOut ? "protect_timeout" : "protect_cancelled");
    return result;
  } catch (error) {
    // Stop the abandoned work at its next checkpoint and swallow its eventual rejection.
    controller.abort();
    work.catch(() => {});
    throw toProtectError(error);
  } finally {
    clearTimeout(timer);
    release();
    outer?.removeEventListener("abort", onOuterAbort);
  }
}
