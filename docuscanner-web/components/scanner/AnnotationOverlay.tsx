"use client";

import { useRef } from "react";
import type { ScannerPage } from "@/utils/scanner/page";
import { useAnnotationCanvas } from "./useAnnotationCanvas";

// Read-only view of a page's annotations, laid over the page image so
// thumbnails and previews show the same marks that end up in the PDF. It fills
// its positioned parent; the parent must be sized to the page image's own
// aspect ratio for the marks to line up (thumbnails crop with object-cover, so
// they use `fit="cover"`).
export function AnnotationOverlay({ page, fit = "contain" }: { page: ScannerPage; fit?: "contain" | "cover" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useAnnotationCanvas(canvasRef, page.annotations, page.processedWidth, page.processedHeight);

  // The canvas is always mounted (just hidden while there's nothing to show):
  // the hook attaches its size observer when the canvas first mounts, so a
  // canvas that only appears later would never be sized or drawn.
  const hidden = page.annotations.length === 0 ? " hidden" : "";

  // With object-cover the image is scaled to fill its 3:4 box and the overflow
  // is cropped; the canvas must be the same scaled size, centred, to line up.
  // A page wider than 3:4 overflows sideways (width = page aspect / 0.75 of
  // the box); a taller one overflows vertically (height = 0.75 / page aspect).
  const pageAspect = page.processedWidth / page.processedHeight;
  const coverStyle =
    fit === "cover"
      ? {
          width: `max(100%, calc(100% * ${(pageAspect / 0.75).toFixed(6)}))`,
          height: `max(100%, calc(100% * ${(0.75 / pageAspect).toFixed(6)}))`,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }
      : undefined;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={
        (fit === "cover" ? "pointer-events-none absolute" : "pointer-events-none absolute inset-0 h-full w-full") + hidden
      }
      style={coverStyle}
    />
  );
}
