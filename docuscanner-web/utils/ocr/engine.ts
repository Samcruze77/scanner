"use client";

// Thin wrapper over tesseract.js. It is loaded with a dynamic import() only
// when the user actually runs OCR, so none of it reaches the homepage or
// initial /scan bundle. The heavy lifting (WASM) runs in a Web Worker, so the
// UI thread stays responsive; the worker is terminated after every run to give
// the memory (~100+ MB of WASM heap) back to the browser.
//
// tesseract.js swallows some load failures (e.g. a 404 for the language
// file leaves its createWorker() promise pending forever), so every stage is
// raced against an explicit failure signal, a timeout and the caller's
// AbortSignal instead of trusting the library's own promises to settle.

import { OCR_ASSET_PATHS, OCR_LANGUAGE } from "./config";
import { OcrCancelledError, OcrError, type OcrErrorCode } from "./types";

type TesseractModule = typeof import("tesseract.js");
type TesseractWorker = Awaited<ReturnType<TesseractModule["createWorker"]>>;

export interface RecognizedPage {
  text: string;
  confidence: number | null;
}

export interface OcrEngine {
  recognize(
    image: HTMLCanvasElement,
    options: { timeoutMs: number; signal?: AbortSignal; onProgress?: (fraction: number) => void },
  ): Promise<RecognizedPage>;
  terminate(): Promise<void>;
}

// Where each tesseract.js status message falls in overall engine-load
// progress. Only used to drive the progress bar.
const LOAD_STAGES: Record<string, [number, number]> = {
  "loading tesseract core": [0, 0.4],
  "initializing tesseract": [0.4, 0.5],
  "loading language traineddata": [0.5, 0.9],
  "initializing api": [0.9, 1],
};

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "";
}

// Maps whatever the engine threw to a small, non-sensitive error code. The
// raw message is inspected but never surfaced or sent anywhere.
export function classifyOcrError(error: unknown, fallback: OcrErrorCode): OcrError | OcrCancelledError {
  if (error instanceof OcrError || error instanceof OcrCancelledError) return error;
  const message = messageOf(error);
  if (/out of memory|oom|cannot enlarge memory|allocation failed|RangeError/i.test(message)) {
    return new OcrError("out_of_memory");
  }
  if (fallback === "ocr_failed" && /read image|decode|unsupported|invalid image|pix/i.test(message)) {
    return new OcrError("unsupported_image");
  }
  return new OcrError(fallback);
}

function guard<T>(
  work: Promise<T>,
  fatal: Promise<never>,
  timeoutMs: number,
  timeoutCode: OcrErrorCode,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const limits = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OcrError(timeoutCode)), timeoutMs);
    if (signal) {
      if (signal.aborted) {
        reject(new OcrCancelledError());
        return;
      }
      onAbort = () => reject(new OcrCancelledError());
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  return Promise.race([work, fatal, limits]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}

export async function loadOcrEngine(options: {
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}): Promise<OcrEngine> {
  const { timeoutMs, signal, onProgress } = options;
  if (signal?.aborted) throw new OcrCancelledError();

  // tesseract.js is CommonJS; depending on the bundler its API is on the
  // namespace itself or under `default`.
  let tesseract: TesseractModule & { default?: TesseractModule };
  try {
    tesseract = await import("tesseract.js");
  } catch {
    throw new OcrError("engine_load_failed");
  }
  if (signal?.aborted) throw new OcrCancelledError();
  const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker;
  if (!createWorker) throw new OcrError("engine_load_failed");

  let rejectFatal: (reason: unknown) => void = () => {};
  const fatal = new Promise<never>((_, reject) => {
    rejectFatal = reject;
  });
  fatal.catch(() => {}); // settled via race; avoid an unhandled-rejection warning

  let pageProgress: ((fraction: number) => void) | undefined;
  let worker: TesseractWorker | null = null;
  let abandoned = false;

  const terminate = async () => {
    const current = worker;
    worker = null;
    try {
      await current?.terminate();
    } catch {
      // Already gone.
    }
  };

  try {
    const pending = createWorker(OCR_LANGUAGE, undefined, {
      workerPath: OCR_ASSET_PATHS.worker,
      corePath: OCR_ASSET_PATHS.core,
      langPath: OCR_ASSET_PATHS.lang,
      workerBlobURL: false,
      logger: (message) => {
        if (message.status === "recognizing text") {
          pageProgress?.(Math.min(1, Math.max(0, message.progress)));
          return;
        }
        const stage = LOAD_STAGES[message.status];
        if (stage) onProgress?.(stage[0] + (stage[1] - stage[0]) * message.progress);
      },
      errorHandler: (error) => rejectFatal(error),
    });
    // A load that timed out or was cancelled can still resolve later; don't
    // let that late worker linger.
    pending.then(
      (late) => {
        if (abandoned) void late.terminate().catch(() => {});
      },
      () => {},
    );
    worker = await guard(pending, fatal, timeoutMs, "engine_load_failed", signal);
  } catch (error) {
    abandoned = true;
    throw classifyOcrError(error, "engine_load_failed");
  }
  onProgress?.(1);

  return {
    async recognize(image, { timeoutMs: pageTimeoutMs, signal: pageSignal, onProgress: onPageProgress }) {
      const active = worker;
      if (!active) throw new OcrError("ocr_failed");
      pageProgress = onPageProgress;
      try {
        const result = await guard(active.recognize(image), fatal, pageTimeoutMs, "ocr_timeout", pageSignal);
        const { text, confidence } = result.data;
        return {
          text: typeof text === "string" ? text : "",
          confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : null,
        };
      } catch (error) {
        const classified = classifyOcrError(error, "ocr_failed");
        // A timed-out/cancelled/crashed recognition leaves the worker
        // mid-job and unusable; drop it so nothing keeps burning CPU and
        // memory. A bad image is the one failure the worker survives.
        const survivable = classified instanceof OcrError && classified.code === "unsupported_image";
        if (!survivable) await terminate();
        throw classified;
      } finally {
        pageProgress = undefined;
      }
    },
    terminate,
  };
}
