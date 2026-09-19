import type { CapturedImage } from "./image";
import type { Quad } from "./geometry";
import type { EnhancementMode } from "./enhance";

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

  quad: Quad | null;
  quadConfidence: number;
  cropEnabled: boolean;
  rotation: PageRotation;
  enhancement: EnhancementMode;

  // Cached render of the above, shown in thumbnails and used for the PDF.
  processedDataUrl: string;
  processedWidth: number;
  processedHeight: number;

  status: PageStatus;
  statusLabel: string | null;
}

export function createInitialPage(captured: CapturedImage): ScannerPage {
  return {
    id: captured.id,
    originalDataUrl: captured.dataUrl,
    originalWidth: captured.width,
    originalHeight: captured.height,
    quad: null,
    quadConfidence: 0,
    cropEnabled: false,
    rotation: 0,
    enhancement: "original",
    processedDataUrl: captured.dataUrl,
    processedWidth: captured.width,
    processedHeight: captured.height,
    status: "detecting",
    statusLabel: "Detecting document…",
  };
}
