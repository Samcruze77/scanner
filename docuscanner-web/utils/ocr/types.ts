// Data model for OCR output. Deliberately independent of the UI and of the
// scanner's page state so it can later be persisted, indexed, or searched
// across documents without reshaping: text is held per page (with a stable
// page id + number) and the combined document text is derived from it.

export type OcrTier = "basic";

export type OcrErrorCode =
  | "too_many_pages"
  | "unsupported_image"
  | "engine_load_failed"
  | "ocr_timeout"
  | "out_of_memory"
  | "ocr_failed";

export type OcrPageStatus = "done" | "empty" | "error";

export interface OcrPageResult {
  pageId: string;
  // 1-based position in the document when OCR ran.
  pageNumber: number;
  text: string;
  // Mean word confidence 0-100 as reported by the engine, null if unknown.
  confidence: number | null;
  status: OcrPageStatus;
  errorCode?: OcrErrorCode;
  // Fingerprint of the page render that was read; lets the UI tell when the
  // page was edited after OCR (see ocrSourceKey).
  sourceKey: string;
}

export interface OcrDocumentResult {
  pages: OcrPageResult[];
  // Page texts joined in order (see combinePageText). The user's edits live
  // in UI state, so this stays the untouched engine output.
  documentText: string;
  scope: "page" | "document";
  tier: OcrTier;
  language: string;
  engine: "tesseract.js";
  createdAt: number;
}

export interface OcrProgress {
  phase: "loading_engine" | "recognizing";
  // 0-based index within this run, and how many pages the run covers.
  pageIndex: number;
  pageCount: number;
  // 0-1 progress of the current phase step (engine load, or current page).
  fraction: number;
}

export class OcrError extends Error {
  readonly code: OcrErrorCode;
  constructor(code: OcrErrorCode) {
    super(code);
    this.name = "OcrError";
    this.code = code;
  }
}

export class OcrCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "OcrCancelledError";
  }
}
