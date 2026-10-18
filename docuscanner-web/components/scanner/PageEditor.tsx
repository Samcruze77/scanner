"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { FlattenNotice } from "./FlattenNotice";
import { PrintButton } from "@/components/print/PrintButton";
import { PRINT_FIT_NOTE } from "@/utils/print/printPages";
import { scannerPagesToPrintPages } from "@/utils/print/sources";
import type { ScannerPage } from "@/utils/scanner/page";
import { ENHANCEMENT_MODES, type EnhancementMode } from "@/utils/scanner/enhance";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { useFitBox } from "./useFitBox";
import { useZoom, ZoomControls, ZoomFrame, ZoomViewport } from "./zoom";

// A range slider that only asks for a re-render when the user lets go. The
// page is re-rendered from the original on every commit, so doing that on each
// tick of a drag would make it stutter. While dragging, the value shown is
// local; once committed, the page's own value is the source of truth again.
function AdjustmentSlider({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;

  function commit() {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  }

  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 font-medium">{label}</span>
      <input
        type="range"
        min={-100}
        max={100}
        step={5}
        value={shown}
        disabled={disabled}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-11 min-w-0 flex-1 accent-blue-600 disabled:opacity-50"
      />
      <span className="muted w-10 shrink-0 text-right tabular-nums">{shown > 0 ? `+${shown}` : shown}</span>
    </label>
  );
}

export function PageEditor({
  page,
  index,
  onClose,
  onRotate,
  onAdjustCrop,
  onAnnotate,
  onToggleCrop,
  onEnhancementChange,
  onAdjustmentChange,
  onResetToOriginal,
  onRemove,
  onExtractText,
  extractTextDisabled,
}: {
  page: ScannerPage;
  index: number;
  onClose: () => void;
  onRotate: (direction: "left" | "right") => void;
  onAdjustCrop: () => void;
  onAnnotate: () => void;
  onToggleCrop: () => void;
  onEnhancementChange: (mode: EnhancementMode) => void;
  onAdjustmentChange: (patch: { brightness?: number; contrast?: number }) => void;
  onResetToOriginal: () => void;
  onRemove: () => void;
  onExtractText?: () => void;
  extractTextDisabled?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const zoom = useZoom();
  // Desktop: the tools column can be folded away so the page gets the whole width.
  const [toolsOpen, setToolsOpen] = useState(true);
  // The page is fitted to the room the stage really has (see useFitBox), so it is as large as the
  // window allows instead of a fixed share of the screen height.
  const { ref: stageRef, box: stageBox } = useFitBox(page.processedWidth / page.processedHeight, 6);
  const processing = page.status === "detecting" || page.status === "processing";

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasQuad = page.quad !== null;
  const isModified =
    page.cropEnabled ||
    page.rotation !== 0 ||
    page.enhancement !== "original" ||
    page.brightness !== 0 ||
    page.contrast !== 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit page ${index + 1}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/60 sm:p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Phone: the whole screen (respecting its notches), one column - the page first, large, then
          the tools below it. Desktop: the page fills the window with the tools in a column beside it that
          can be hidden; each scrolls on its own. */}
      <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col overflow-hidden bg-elevated shadow-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 py-1.5 pl-4 pr-2 pt-[max(0.375rem,env(safe-area-inset-top))] dark:border-zinc-800">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Edit page {index + 1}</h2>
          <button
            type="button"
            onClick={() => setToolsOpen((v) => !v)}
            aria-expanded={toolsOpen}
            data-assistant-id="page-toggle-tools"
            className="btn btn-ghost hidden lg:inline-flex"
          >
            {toolsOpen ? "Hide tools" : "Show tools"}
          </button>
          <button type="button" onClick={onClose} data-assistant-id="page-done" className="btn btn-primary hidden whitespace-nowrap lg:inline-flex">
            Done editing
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="btn btn-icon btn-ghost"
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:overflow-hidden">
          <div className="p-2 sm:p-3 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col">
            {/* The stage: on a phone a tall fixed share of the screen, on desktop all the height left. The
                page is measured into it, so it is never smaller than the room allows. shrink-0 stops a
                flex item with overflow-hidden collapsing to 0px in a short window. */}
            <div
              ref={stageRef}
              data-page-stage
              className="relative h-[calc(100dvh-15.5rem)] min-h-[18rem] shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-950 lg:h-auto lg:min-h-0 lg:flex-1"
            >
              <ZoomViewport api={zoom} className="absolute inset-0 overflow-auto p-1.5">
                <ZoomFrame zoom={zoom.zoom} fit={stageBox ? `${stageBox.w}px` : `min(100%, calc(60dvh * ${page.processedWidth / page.processedHeight}))`}>
                  {/* The wrapper is exactly as big as the image, so marks drawn over it
                      (see AnnotationOverlay) line up with the page at any zoom. */}
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
                    <img src={page.processedDataUrl} alt={`Page ${index + 1} preview`} className="block h-auto w-full" />
                    <AnnotationOverlay page={page} />
                  </div>
                </ZoomFrame>
              </ZoomViewport>
              {processing && (
                <div
                  role="status"
                  className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-medium text-white"
                >
                  {page.statusLabel ?? "Processing…"}
                </div>
              )}
            </div>
            <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={onAnnotate} disabled={processing} data-assistant-id="page-annotate" className="btn btn-primary">
                <Icon name="signature" size={18} />
                {page.annotations.length > 0
                  ? `Edit text, signature & marks (${page.annotations.length})`
                  : "Add text, signature & marks"}
              </button>
              <ZoomControls api={zoom} fit />
            </div>
          </div>

          <div
            className={`space-y-5 border-t border-zinc-200 p-4 dark:border-zinc-800 lg:w-[340px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0 ${
              toolsOpen ? "" : "lg:hidden"
            }`}
          >
            <div>
              <p className="panel-title mb-2">Crop</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onAdjustCrop} disabled={processing} className="btn btn-secondary">
                  <Icon name="crop" size={18} />
                  Adjust crop
                </button>
                {hasQuad && (
                  <button type="button" onClick={onToggleCrop} disabled={processing} className="btn btn-secondary">
                    {page.cropEnabled ? "Remove crop" : "Use crop"}
                  </button>
                )}
              </div>
              {!hasQuad && (
                <p className="muted mt-2 text-sm">
                  No document boundary was detected, so the original framing is kept. Use Adjust crop to set it yourself.
                </p>
              )}
            </div>

            <div>
              <p className="panel-title mb-2">Rotate</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onRotate("left")}
                  disabled={processing}
                  aria-label="Rotate left"
                  className="btn btn-icon btn-secondary"
                >
                  <Icon name="rotate-left" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => onRotate("right")}
                  disabled={processing}
                  aria-label="Rotate right"
                  className="btn btn-icon btn-secondary"
                >
                  <Icon name="rotate-right" size={18} />
                </button>
              </div>
            </div>

            <div>
              <p className="panel-title mb-2">Enhancement</p>
              <div className="flex flex-wrap gap-2">
                {ENHANCEMENT_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => onEnhancementChange(m.value)}
                    disabled={processing}
                    aria-pressed={page.enhancement === m.value}
                    className={`btn px-3 ${page.enhancement === m.value ? "btn-primary" : "btn-secondary"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="panel-title mb-1">Adjust</p>
              <p className="muted mb-1 text-xs">Adjust brightness and contrast below.</p>
              <AdjustmentSlider
                label="Brightness"
                value={page.brightness}
                disabled={processing}
                onCommit={(brightness) => onAdjustmentChange({ brightness })}
              />
              <AdjustmentSlider
                label="Contrast"
                value={page.contrast}
                disabled={processing}
                onCommit={(contrast) => onAdjustmentChange({ contrast })}
              />
            </div>

            <FlattenNotice page={page} before />

            <div className="hidden flex-wrap gap-2 lg:flex">
              <button type="button" onClick={onResetToOriginal} disabled={processing || !isModified} className="btn btn-ghost">
                Reset to original
              </button>
              <button type="button" onClick={onRemove} className="btn btn-ghost text-red-700 dark:text-red-400">
                Remove page
              </button>
            </div>

            {onExtractText && (
              <div>
                <p className="panel-title mb-2">Text</p>
                <button
                  type="button"
                  onClick={onExtractText}
                  disabled={processing || extractTextDisabled}
                  className="btn btn-secondary"
                >
                  <Icon name="ocr" size={18} />
                  Extract text from this page
                </button>
              </div>
            )}

            <div>
              <p className="panel-title mb-2">Print</p>
              <div className="flex flex-wrap gap-2">
                <PrintButton
                  source="editor_page"
                  title={`page-${index + 1}`}
                  label="Print this page"
                  disabled={processing}
                  note={page.annotations.some((a) => a.type === "image") ? PRINT_FIT_NOTE : undefined}
                  getPages={() => scannerPagesToPrintPages([page])}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-zinc-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-800 lg:hidden">
          <button
            type="button"
            onClick={onResetToOriginal}
            disabled={processing || !isModified}
            className="btn btn-ghost"
          >
            Reset to original
          </button>
          <button type="button" onClick={onRemove} className="btn btn-ghost text-red-700 dark:text-red-400">
            Remove page
          </button>
          <button type="button" onClick={onClose} className="btn btn-primary min-w-28 flex-1 sm:ml-auto sm:flex-none">
            Done editing
          </button>
        </div>
      </div>
    </div>
  );
}
