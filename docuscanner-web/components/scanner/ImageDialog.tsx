"use client";

// Choose a picture (passport photograph, logo, stamp, scan...), turn and crop it,
// optionally give it a stated real-world size, then hand it back to the
// annotation editor to place on the page. The picture is read and edited in the
// browser; nothing is uploaded. Cancelling leaves the page exactly as it was.

import { useEffect, useRef, useState } from "react";
import {
  aspectCropRect,
  getPreset,
  moveRect,
  PHOTO_PRESETS,
  presetFractions,
  rectFromPoints,
  type Rect,
} from "@/utils/scanner/imagePlacement";
import { InsertImageError, readInsertImage, renderEdit, type InsertImage } from "@/utils/scanner/imageInsert";
import type { ImageOriginal } from "@/utils/scanner/annotations";

// The editing preview is a small copy; the picture that is placed is always made from the
// untouched original (see renderEdit), so the preview's size never limits export quality.
const PREVIEW_SIDE_PX = 1200;

export interface ImageChoice {
  // The picture to draw and export, and the untouched original it came from.
  image: InsertImage;
  original: ImageOriginal;
  // A preset size the picture was cropped to; the page is told its real size.
  presetId: string | null;
}

const MIN_CROP = 0.05;

export function ImageDialog({
  mode,
  pageWidthPx,
  pageHeightPx,
  ptPerPx,
  onApply,
  onCancel,
}: {
  mode: "insert" | "replace";
  pageWidthPx: number;
  pageHeightPx: number;
  // The page's physical scale when it came from a PDF (see pageLayout.ts).
  ptPerPx?: number;
  onApply: (choice: ImageChoice) => void;
  onCancel: () => void;
}) {
  // `source` describes the picture as it is shown: the preview copy's pixels, but the
  // full turned size of the original (for crop shapes). `original` is never changed.
  const [source, setSource] = useState<InsertImage | null>(null);
  const [original, setOriginal] = useState<InsertImage | null>(null);
  const [turns, setTurns] = useState<0 | 1 | 2 | 3>(0);
  const [presetId, setPresetId] = useState<string>("");
  const [crop, setCrop] = useState<Rect | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    { kind: "move"; lastX: number; lastY: number } | { kind: "draw"; ox: number; oy: number } | null
  >(null);
  // The latest request wins, so a slow decode can't overwrite a newer choice.
  const tokenRef = useRef(0);

  const preset = getPreset(presetId);
  const presetSize = preset ? presetFractions(preset, pageWidthPx, pageHeightPx, ptPerPx) : null;
  const presetAspect = preset ? preset.widthMm / preset.heightMm : null;

  useEffect(() => {
    chooseRef.current?.focus();
    // Capture phase so Escape closes only this dialog, not the editors under it.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const token = ++tokenRef.current;
    setBusy(true);
    setError(null);
    try {
      const image = await readInsertImage(file);
      const preview = await renderEdit(image, 0, null, PREVIEW_SIDE_PX);
      if (token !== tokenRef.current) return;
      setOriginal(image);
      setTurns(0);
      setSource({ dataUrl: preview.dataUrl, width: image.width, height: image.height, mime: image.mime });
      setCrop(null);
      setZoom(1);
    } catch (err) {
      if (token !== tokenRef.current) return;
      setError(err instanceof InsertImageError ? err.message : "That picture couldn't be opened. Try a different file.");
    } finally {
      if (token === tokenRef.current) setBusy(false);
    }
  }

  // Locked-ratio crop for a preset size: the largest box of that shape, which
  // can be dragged and zoomed. Free crop: whatever the person draws.
  const activeCrop: Rect | null = source
    ? presetAspect
      ? crop && Math.abs(crop.w * source.width / (crop.h * source.height) - presetAspect) < 0.02
        ? crop
        : aspectCropRect(source.width, source.height, presetAspect, zoom)
      : crop
    : null;

  function choosePreset(id: string) {
    setPresetId(id);
    setCrop(null);
    setZoom(1);
  }

  function changeZoom(value: number) {
    if (!source || !presetAspect) return;
    const base = activeCrop ?? aspectCropRect(source.width, source.height, presetAspect, 1);
    setZoom(value);
    setCrop(aspectCropRect(source.width, source.height, presetAspect, value, base.x + base.w / 2, base.y + base.h / 2));
  }

  async function rotate(direction: 1 | -1) {
    if (!source || !original) return;
    const token = ++tokenRef.current;
    setBusy(true);
    try {
      const next = ((turns + direction + 4) % 4) as 0 | 1 | 2 | 3;
      const preview = await renderEdit(original, next, null, PREVIEW_SIDE_PX);
      if (token !== tokenRef.current) return;
      setTurns(next);
      const swapped = next % 2 === 1;
      setSource({ dataUrl: preview.dataUrl, width: swapped ? original.height : original.width, height: swapped ? original.width : original.height, mime: original.mime });
      setCrop(null);
      setZoom(1);
    } catch {
      if (token === tokenRef.current) setError("That picture couldn't be turned. Try a smaller picture.");
    } finally {
      if (token === tokenRef.current) setBusy(false);
    }
  }

  function framePoint(e: React.PointerEvent): { x: number; y: number } | null {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!source || busy) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = framePoint(e);
    if (!p) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Dragging still works inside the frame without capture.
    }
    if (presetAspect) {
      // Dragging anywhere slides the fixed-shape crop box.
      setCrop(activeCrop);
      dragRef.current = { kind: "move", lastX: p.x, lastY: p.y };
    } else {
      dragRef.current = { kind: "draw", ox: p.x, oy: p.y };
      setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const p = framePoint(e);
    if (!drag || !p) return;
    if (drag.kind === "move" && activeCrop) {
      setCrop(moveRect(activeCrop, p.x - drag.lastX, p.y - drag.lastY));
      drag.lastX = p.x;
      drag.lastY = p.y;
    } else if (drag.kind === "draw") {
      setCrop(rectFromPoints(drag.ox, drag.oy, p.x, p.y));
    }
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    // A tap, or a sliver, is not a crop.
    if (drag?.kind === "draw" && crop && (crop.w < MIN_CROP || crop.h < MIN_CROP)) setCrop(null);
  }

  async function apply() {
    if (!source || !original) return;
    setBusy(true);
    setError(null);
    try {
      if (preset && !presetSize) {
        setError("That size doesn't fit on this page. Choose a smaller size, or \"Keep the picture's shape\".");
        return;
      }
      const rect = activeCrop;
      const isWhole = !rect || (rect.w > 0.995 && rect.h > 0.995);
      const crop = rect && !isWhole && rect.w >= MIN_CROP && rect.h >= MIN_CROP ? rect : null;
      // One pass from the original pixels: turn, then crop. No earlier edit is re-encoded.
      const result = await renderEdit(original, turns, crop);
      onApply({
        image: result,
        original: { dataUrl: original.dataUrl, width: original.width, height: original.height, mime: original.mime, turns, crop },
        presetId: preset ? preset.id : null,
      });
    } catch {
      setError("The picture couldn't be prepared. Try a smaller picture.");
    } finally {
      setBusy(false);
    }
  }

  const chip = "flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium border-zinc-300 dark:border-zinc-700 disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-dialog-title"
        data-assistant-id="image-dialog"
        className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:max-h-[92dvh] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 id="image-dialog-title" className="text-base font-semibold">
            {mode === "replace" ? "Replace picture" : "Add a picture"}
          </h2>
          <button type="button" onClick={onCancel} className="btn btn-ghost px-3">
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            aria-label="Choose a picture: JPG, PNG or WebP"
            className="sr-only"
            tabIndex={-1}
            data-assistant-id="image-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void chooseFile(file);
            }}
          />

          {!source && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void chooseFile(e.dataTransfer.files?.[0]);
              }}
              className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center ${dragOver ? "border-blue-600 bg-blue-50 dark:bg-blue-950" : "border-zinc-300 dark:border-zinc-700"}`}
            >
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Add a passport photograph, signature, logo, stamp or any other picture. JPG, PNG and WebP work.
              </p>
              <button ref={chooseRef} type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn btn-primary">
                {busy ? "Opening picture…" : "Choose a picture"}
              </button>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Your picture stays on your device. It is never uploaded.</p>
            </div>
          )}

          {source && (
            <>
              <div
                ref={frameRef}
                className="relative mx-auto max-h-[42dvh] w-fit max-w-full select-none overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800"
                style={{ touchAction: "none", cursor: "crosshair" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
                <img
                  src={source.dataUrl}
                  alt="Your picture, ready to place on the page"
                  draggable={false}
                  className="pointer-events-none block max-h-[42dvh] max-w-full"
                  style={{ aspectRatio: `${source.width} / ${source.height}` }}
                />
                {activeCrop && activeCrop.w > 0 && (
                  <div
                    aria-hidden
                    data-testid="crop-box"
                    className="pointer-events-none absolute border-2 border-blue-600"
                    style={{
                      left: `${activeCrop.x * 100}%`,
                      top: `${activeCrop.y * 100}%`,
                      width: `${activeCrop.w * 100}%`,
                      height: `${activeCrop.h * 100}%`,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                    }}
                  />
                )}
              </div>
              <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                {presetAspect
                  ? "Drag the picture to choose what stays inside the box."
                  : activeCrop
                    ? "Cropped. Drag again to change it, or tap Reset crop."
                    : "To crop, drag a box over the part you want to keep. Otherwise the whole picture is used."}
              </p>

              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void rotate(-1)} className={chip} aria-label="Rotate left">
                  {"↺"} Rotate left
                </button>
                <button type="button" disabled={busy} onClick={() => void rotate(1)} className={chip} aria-label="Rotate right">
                  {"↻"} Rotate right
                </button>
                {!presetAspect && (
                  <button type="button" disabled={busy || !crop} onClick={() => setCrop(null)} className={chip}>
                    Reset crop
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={chip}>
                  Choose another
                </button>
              </div>

              <div>
                <label htmlFor="image-size" className="mb-1 block text-sm font-medium">
                  Size on the page
                </label>
                <select
                  id="image-size"
                  value={presetId}
                  onChange={(e) => choosePreset(e.target.value)}
                  className="min-h-11 w-full rounded-lg border border-zinc-300 bg-surface px-3 text-sm dark:border-zinc-700"
                >
                  <option value="">Keep the picture&apos;s shape (resize freely)</option>
                  {PHOTO_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      Photo: {p.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Passport and ID photo sizes are different for every country and application. Check the size you need before you choose one.
                  Sizes are exact in the downloaded PDF when you print it at Actual size (100%) with Fit to page turned off. The Print button fits the page to the paper, so a photo comes out a little smaller.
                </p>
              </div>

              {presetAspect && (
                <div>
                  <label htmlFor="image-zoom" className="mb-1 block text-sm font-medium">
                    Zoom in on the face or subject
                  </label>
                  <input
                    id="image-zoom"
                    type="range"
                    min={0}
                    max={0.8}
                    step={0.01}
                    value={1 - zoom}
                    onChange={(e) => changeZoom(1 - Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          )}
        </div>

        {source && (
          <div className="flex shrink-0 gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
            <button type="button" onClick={onCancel} className="btn btn-ghost">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void apply()} className="btn btn-primary ml-auto min-w-32">
              {mode === "replace" ? "Replace picture" : "Place on page"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
