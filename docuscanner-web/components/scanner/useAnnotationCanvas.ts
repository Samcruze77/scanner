"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Annotation } from "@/utils/scanner/annotations";
import { hasUnloadedImages, ensureAnnotationImages, renderAnnotations } from "@/utils/scanner/annotationRender";

// Keeps a <canvas> showing the given annotations, sharpened for the display's
// pixel density and redrawn when the annotations, the page size or the canvas's
// on-screen size change. The canvas is expected to fill (and be sized by) its
// parent via CSS; drawing is done in the page's reference pixels and scaled.
export function useAnnotationCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  annotations: Annotation[],
  pageWidth: number,
  pageHeight: number,
  skipId?: string | null,
): void {
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Bumped when signature images finish decoding, to redraw with them.
  const [imagesReady, setImagesReady] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);

  useEffect(() => {
    if (!hasUnloadedImages(annotations)) return;
    let cancelled = false;
    void ensureAnnotationImages(annotations).then(() => {
      if (!cancelled) setImagesReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [annotations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0 || pageWidth === 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / pageWidth, 0, 0, canvas.height / pageHeight, 0, 0);
    renderAnnotations(ctx, pageWidth, pageHeight, annotations, { skipId });
  }, [canvasRef, annotations, size, pageWidth, pageHeight, skipId, imagesReady]);
}
