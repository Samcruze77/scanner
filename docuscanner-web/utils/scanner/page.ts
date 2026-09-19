import type { CapturedImage } from "./image";
import type { Quad } from "./geometry";
import type { EnhancementMode } from "./enhance";
import type { Annotation } from "./annotations";

export type PageRotation = 0 | 90 | 180 | 270;
export type PageStatus = "detecting" | "processing" | "ready" | "error";

export interface ScannerPage {
  id: string;
  // Immutable capture -- never overwritten. Every other field is a
  // processing instruction; the rendered result is always re-derived from
  // this plus those instructions (see pageProcessing.ts), never from a
  // previously-processed image, so edits are never destructive or lossy
  // across repeated changes.
  originalDataUrl: string;
  originalWidth: number;
  originalHeight: number;

  // The active crop, in original-image pixels (top-left, top-right,
  // bottom-right, bottom-left). Starts as the auto-detected boundary and is
  // replaced when the user adjusts the corners by hand.
  quad: Quad | null;
  // What auto-detection found, kept so a manual crop can be reset to it.
  detectedQuad: Quad | null;
  quadConfidence: number;
  cropEnabled: boolean;
  rotation: PageRotation;
  enhancement: EnhancementMode;
  // -100..100, 0 = unchanged. Applied after the enhancement mode.
  brightness: number;
  contrast: number;

  // Cached render of the above, shown in thumbnails and used for the PDF.
  // Deliberately WITHOUT annotations: the clean page is what OCR reads and what
  // crop/rotate/enhance re-derive, so those keep working exactly as before.
  processedDataUrl: string;
  processedWidth: number;
  processedHeight: number;

  // Text, pen, highlights, stamps and signatures drawn on top of the page, in
  // coordinates normalized to the processed image (see annotations.ts). They
  // belong to the page, so they follow it when pages are reordered, and are
  // flattened into the image only when the PDF is created.
  annotations: Annotation[];

  status: PageStatus;
  statusLabel: string | null;
}

export function createInitialPage(captured: CapturedImage, options: { skipDetection?: boolean } = {}): ScannerPage {
  return {
    id: captured.id,
    originalDataUrl: captured.dataUrl,
    originalWidth: captured.width,
    originalHeight: captured.height,
    quad: null,
    detectedQuad: null,
    quadConfidence: 0,
    cropEnabled: false,
    rotation: 0,
    enhancement: "original",
    brightness: 0,
    contrast: 0,
    processedDataUrl: captured.dataUrl,
    processedWidth: captured.width,
    processedHeight: captured.height,
    annotations: [],
    // Pages rendered from a PDF are already flat and square-on, so there is
    // no perspective to detect; they go straight to "ready" (the user can
    // still crop them by hand).
    status: options.skipDetection ? "ready" : "detecting",
    statusLabel: options.skipDetection ? null : "Detecting document…",
  };
}
