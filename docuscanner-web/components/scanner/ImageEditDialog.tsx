"use client";

// Edit a picture that is already on the page: crop it (free or to a fixed shape), turn it, give it a
// stated print size, and see exactly what will be kept before anything changes. Cancel leaves the page
// as it was; Apply is ONE undo step.
//
// Nothing here touches the original picture. The preview is a small copy made from the original, but
// every crop is stored as a FRACTION of the picture and applied to the full-size original when you
// choose Apply (see renderEdit), so the preview's size never limits the result.

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { CropOverlay } from "@/components/tools/CropOverlay";
import { ASPECT_PRESETS, fitAspect } from "@/utils/imageEdit/crop";
import type { ImageOriginal } from "@/utils/scanner/annotations";
import { PHOTO_PRESETS, rotateRect, type Rect, type Turns } from "@/utils/scanner/imagePlacement";
import { renderEdit, type InsertImage } from "@/utils/scanner/imageInsert";
import { useFitBox } from "./useFitBox";

const PREVIEW_SIDE_PX = 1600;
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

// What the person chose for the size on the page: leave it, go back to the size it was placed at, or a
// stated real-world size. The picture's pixels are never reduced to reach any of these.
export type SizeChoice = { kind: "keep" } | { kind: "reset" } | { kind: "preset"; id: string };

export interface ImageEditResult {
  turns: Turns;
  crop: Rect | null;
  size: SizeChoice;
}

function isWhole(crop: Rect | null): boolean {
  return !crop || (crop.w > 0.9995 && crop.h > 0.9995);
}

export function ImageEditDialog({
  original,
  startTurns,
  startCrop,
  onApply,
  onCancel,
}: {
  original: ImageOriginal;
  startTurns: Turns;
  startCrop: Rect | null;
  onApply: (result: ImageEditResult) => void;
  onCancel: () => void;
}) {
  const [turns, setTurns] = useState<Turns>(startTurns);
  const [crop, setCrop] = useState<Rect>(startCrop ?? FULL);
  const [ratioId, setRatioId] = useState("free");
  const [size, setSize] = useState<SizeChoice>({ kind: "keep" });
  const [preview, setPreview] = useState<InsertImage | null>(null);
  const [failed, setFailed] = useState(false);

  // The preview is the whole turned picture, drawn from the original at a small size.
  useEffect(() => {
    let cancelled = false;
    renderEdit(original, turns, null, PREVIEW_SIDE_PX).then(
      (out) => {
        if (!cancelled) setPreview(out);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [original, turns]);

  const turned = turns % 2 === 1;
  const fullW = turned ? original.height : original.width;
  const fullH = turned ? original.width : original.height;
  const pw = preview?.width ?? 1;
  const ph = preview?.height ?? 1;
  const { ref, box } = useFitBox(pw / ph, 8);
  const printSize = size.kind === "preset" ? PHOTO_PRESETS.find((p) => p.id === size.id) : undefined;
  const ratio = printSize ? printSize.widthMm / printSize.heightMm : (ASPECT_PRESETS.find((p) => p.id === ratioId)?.ratio ?? null);

  const rectPx = { x: Math.round(crop.x * pw), y: Math.round(crop.y * ph), w: Math.max(1, Math.round(crop.w * pw)), h: Math.max(1, Math.round(crop.h * ph)) };
  const keptW = Math.max(1, Math.round(crop.w * fullW));
  const keptH = Math.max(1, Math.round(crop.h * fullH));

  function toFractions(px: { x: number; y: number; w: number; h: number }): Rect {
    return { x: px.x / pw, y: px.y / ph, w: px.w / pw, h: px.h / ph };
  }

  function chooseRatio(id: string) {
    setRatioId(id);
    if (size.kind === "preset") setSize({ kind: "keep" });
    const preset = ASPECT_PRESETS.find((p) => p.id === id);
    // A shape applies at once, inside what is chosen now, so the effect is visible.
    if (preset?.ratio) setCrop(toFractions(fitAspect(rectPx, preset.ratio, { w: pw, h: ph })));
  }

  function turn(direction: 1 | -1) {
    setTurns(((turns + direction + 4) % 4) as Turns);
    setCrop((c) => rotateRect(c, direction));
    setPreview(null);
  }

  function choosePrintSize(id: string) {
    if (id === "__reset") {
      setSize({ kind: "reset" });
      return;
    }
    if (!id) {
      setSize({ kind: "keep" });
      return;
    }
    const p = PHOTO_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setSize({ kind: "preset", id });
    setRatioId("free");
    // The shape of the print size decides the crop; pixels are only ever trimmed, never squeezed.
    setCrop(toFractions(fitAspect(rectPx, p.widthMm / p.heightMm, { w: pw, h: ph })));
  }

  function resetCrop() {
    setCrop(FULL);
    setRatioId("free");
    if (size.kind === "preset") setSize({ kind: "keep" });
  }

  function restoreOriginal() {
    setTurns(0);
    setCrop(FULL);
    setRatioId("free");
    setSize({ kind: "reset" });
    setPreview(null);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onCancel]);

  const chip = "flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-medium";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit picture"
      data-image-edit-dialog
      className="fixed inset-0 z-[70] flex flex-col bg-zinc-100 pb-[env(safe-area-inset-bottom)] dark:bg-zinc-950"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-surface px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] dark:border-zinc-800">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Edit picture</h2>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
        <button
          type="button"
          data-assistant-id="image-edit-apply"
          disabled={!preview}
          onClick={() => onApply({ turns, crop: isWhole(crop) ? null : crop, size })}
          className="btn btn-primary"
        >
          Apply
        </button>
      </div>

      <div ref={ref} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        {failed && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            That picture couldn&apos;t be opened for editing. Cancel and try again.
          </p>
        )}
        {preview && box && (
          <div className="relative shrink-0 bg-white shadow-md" style={{ width: box.w, height: box.h }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
            <img src={preview.dataUrl} alt="The picture being edited" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" />
            <CropOverlay rect={rectPx} bounds={{ w: pw, h: ph }} ratio={ratio} onChange={(r) => setCrop(toFractions(r))} />
          </div>
        )}
        {!preview && !failed && (
          <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
            Opening your picture…
          </p>
        )}
      </div>

      <div className="max-h-[42dvh] shrink-0 space-y-3 overflow-y-auto border-t border-zinc-200 bg-surface p-3 dark:border-zinc-800">
        <p role="status" className="text-sm" data-image-edit-info>
          Keeps {keptW} × {keptH} px of your {original.width} × {original.height} px original. Nothing is thrown away: Restore original always brings it all back.
        </p>

        <div role="group" aria-label="Crop shape" className="flex flex-wrap gap-1.5">
          {ASPECT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={ratioId === p.id && !printSize}
              onClick={() => chooseRatio(p.id)}
              className={`${chip} ${ratioId === p.id && !printSize ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 dark:border-zinc-700"}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Rotate picture left" onClick={() => turn(-1)} className={`${chip} gap-1 border-zinc-300 dark:border-zinc-700`}>
            <Icon name="rotate-left" size={18} /> Left
          </button>
          <button type="button" aria-label="Rotate picture right" onClick={() => turn(1)} className={`${chip} gap-1 border-zinc-300 dark:border-zinc-700`}>
            <Icon name="rotate-right" size={18} /> Right
          </button>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">Print size</span>
            <select
              aria-label="Print size"
              value={size.kind === "preset" ? size.id : size.kind === "reset" ? "__reset" : ""}
              onChange={(e) => choosePrintSize(e.target.value)}
              className="h-11 rounded-lg border border-zinc-300 bg-surface px-2 text-sm dark:border-zinc-700"
            >
              <option value="">Keep the current size</option>
              <option value="__reset">Reset size (as first placed)</option>
              {PHOTO_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" data-assistant-id="image-reset-crop" onClick={resetCrop} className="btn btn-secondary">
            Reset crop
          </button>
          <button type="button" data-assistant-id="image-restore-original" onClick={restoreOriginal} className="btn btn-secondary">
            Restore original
          </button>
        </div>
        <p className="muted text-xs leading-5">
          Reset crop shows the whole picture again and keeps its turn and size. Reset size only changes how big it is on the page. Restore original does both and
          undoes any turn. A print size is a size on paper: your picture keeps all its pixels, and a small picture printed large will look soft (it is never made
          sharper than it is).{" "}
          <a href="/tools/edit-image" target="_blank" rel="noreferrer" className="underline">
            Need flip, brightness or another file type? Open the Edit Image tool in a new tab
          </a>
          .
        </p>
      </div>
    </div>
  );
}
