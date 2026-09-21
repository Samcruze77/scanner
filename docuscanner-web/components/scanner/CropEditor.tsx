"use client";

// Manual crop: four draggable corners over the page's original photo. The
// result is a quad in original-image pixels, which the existing perspective
// pipeline (pageProcessing.ts) already knows how to crop and straighten, so
// this only edits `page.quad` -- it adds no new rendering path.

import { useEffect, useRef, useState } from "react";
import { fullImageQuad, orderQuadCorners, polygonArea, type Point, type Quad } from "@/utils/scanner/geometry";
import type { ScannerPage } from "@/utils/scanner/page";
import { useZoom, ZoomControls, ZoomFrame, ZoomViewport } from "./zoom";

const CORNER_LABELS = ["Top-left corner", "Top-right corner", "Bottom-right corner", "Bottom-left corner"] as const;

// Smallest crop we accept, as a fraction of the whole photo. Anything smaller
// is almost certainly a mis-drag rather than a deliberate crop.
const MIN_AREA_FRACTION = 0.02;

// Starting crop when nothing was detected: the photo, inset a little so every
// handle is comfortably grabbable instead of sitting on the screen edge.
function insetQuad(width: number, height: number): Quad {
  const mx = width * 0.06;
  const my = height * 0.06;
  return [
    { x: mx, y: my },
    { x: width - mx, y: my },
    { x: width - mx, y: height - my },
    { x: mx, y: height - my },
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function CropEditor({
  page,
  onApply,
  onCancel,
}: {
  page: ScannerPage;
  onApply: (quad: Quad) => void;
  onCancel: () => void;
}) {
  const width = page.originalWidth;
  const height = page.originalHeight;

  const [quad, setQuad] = useState<Quad>(() => page.quad ?? insetQuad(width, height));
  const [dragging, setDragging] = useState<number | null>(null);
  const [tooSmall, setTooSmall] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const zoom = useZoom();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setCorner(index: number, point: Point) {
    setTooSmall(false);
    setQuad((prev) => {
      const next = [...prev] as Quad;
      next[index] = { x: clamp(point.x, 0, width), y: clamp(point.y, 0, height) };
      return next;
    });
  }

  function moveToPointer(index: number, clientX: number, clientY: number) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    setCorner(index, {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    });
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    const current = quad[index];
    setCorner(index, { x: current.x + dx * width, y: current.y + dy * height });
  }

  function handleApply() {
    const ordered = orderQuadCorners(quad);
    if (polygonArea(ordered) < width * height * MIN_AREA_FRACTION) {
      setTooSmall(true);
      return;
    }
    onApply(ordered);
  }

  const points = quad.map((p) => `${p.x},${p.y}`).join(" ");
  const maskPath = `M0 0H${width}V${height}H0Z M${quad.map((p) => `${p.x} ${p.y}`).join("L")}Z`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Adjust crop"
      className="fixed inset-0 z-[60] flex flex-col bg-black/70 p-3 sm:items-center sm:justify-center sm:p-4"
    >
      <div className="flex max-h-full w-full flex-col overflow-y-auto rounded-xl bg-white p-4 dark:bg-zinc-900 sm:max-w-lg sm:max-h-[95vh]">
        <h2 className="text-base font-semibold">Adjust crop</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Drag the corners to the edges of your document. Rotation is applied after cropping.
        </p>

        {/* Zoomed in, the photo scrolls inside this window: handy for placing the
            corners exactly. At normal size it is the same fitted view as always. */}
        <ZoomViewport api={zoom} className="mb-2 max-h-[56vh] overflow-auto rounded-lg bg-zinc-100 p-3 dark:bg-zinc-950">
          <ZoomFrame zoom={zoom.zoom} fit={`min(100%, calc(52vh * ${width / height}))`}>
          {/* The frame is sized to the photo's exact aspect ratio, so a
              percentage position inside it is the same point on the photo. */}
          <div
            ref={frameRef}
            className="relative w-full select-none"
            style={{ aspectRatio: `${width} / ${height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
            <img
              src={page.originalDataUrl}
              alt="Original photo to crop"
              draggable={false}
              className="absolute inset-0 h-full w-full"
            />
            <svg
              aria-hidden
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <path d={maskPath} fillRule="evenodd" fill="rgba(0,0,0,0.5)" />
              <polygon points={points} fill="none" stroke="#fff" strokeWidth={5} vectorEffect="non-scaling-stroke" />
              <polygon points={points} fill="none" stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>

            {quad.map((corner, index) => (
              <button
                key={CORNER_LABELS[index]}
                type="button"
                aria-label={`${CORNER_LABELS[index]} -- drag, or use arrow keys`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(index);
                }}
                onPointerMove={(e) => {
                  if (dragging === index) moveToPointer(index, e.clientX, e.clientY);
                }}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                style={{
                  left: `${(corner.x / width) * 100}%`,
                  top: `${(corner.y / height) * 100}%`,
                  touchAction: "none",
                }}
                className="group absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full outline-none active:cursor-grabbing"
              >
                <span
                  className={`h-5 w-5 rounded-full border-[3px] border-blue-600 bg-white shadow-md group-focus-visible:ring-4 group-focus-visible:ring-blue-400 ${
                    dragging === index ? "scale-125" : ""
                  }`}
                />
              </button>
            ))}
          </div>
          </ZoomFrame>
        </ZoomViewport>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-500">Zoom in to place the corners exactly: pinch, or use + and −.</p>
          <ZoomControls api={zoom} />
        </div>

        {tooSmall && (
          <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
            That crop area is too small. Drag the corners further apart.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setTooSmall(false);
              setQuad(fullImageQuad(width, height));
            }}
            className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-medium dark:border-zinc-700"
          >
            Whole page
          </button>
          {page.detectedQuad && (
            <button
              type="button"
              onClick={() => {
                setTooSmall(false);
                setQuad(page.detectedQuad as Quad);
              }}
              className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-medium dark:border-zinc-700"
            >
              Reset to detected
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-md px-4 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="min-h-11 flex-1 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Apply crop
          </button>
        </div>
      </div>
    </div>
  );
}
