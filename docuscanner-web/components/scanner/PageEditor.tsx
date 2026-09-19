"use client";

import { useEffect, useRef } from "react";
import type { ScannerPage } from "@/utils/scanner/page";
import { ENHANCEMENT_MODES, type EnhancementMode } from "@/utils/scanner/enhance";

export function PageEditor({
  page,
  index,
  onClose,
  onRotate,
  onToggleCrop,
  onEnhancementChange,
  onResetToOriginal,
  onRemove,
  onExtractText,
  extractTextDisabled,
}: {
  page: ScannerPage;
  index: number;
  onClose: () => void;
  onRotate: (direction: "left" | "right") => void;
  onToggleCrop: () => void;
  onEnhancementChange: (mode: EnhancementMode) => void;
  onResetToOriginal: () => void;
  onRemove: () => void;
  onExtractText?: () => void;
  extractTextDisabled?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
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
  const isModified = page.cropEnabled || page.rotation !== 0 || page.enhancement !== "original";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit page ${index + 1}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/60 p-3 sm:items-center sm:justify-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full flex-col overflow-y-auto rounded-xl bg-white p-4 dark:bg-zinc-900 sm:max-w-lg sm:max-h-[90vh]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit page {index + 1}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="relative mb-4 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-950">
          {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
          <img
            src={page.processedDataUrl}
            alt={`Page ${index + 1} preview`}
            className="max-h-[45vh] w-full object-contain"
          />
          {processing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-medium text-white">
              {page.statusLabel ?? "Processing…"}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Crop</p>
            {hasQuad ? (
              <button
                type="button"
                onClick={onToggleCrop}
                disabled={processing}
                className="min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
              >
                {page.cropEnabled ? "Use original (remove crop)" : "Use detected crop"}
              </button>
            ) : (
              <p className="text-sm text-zinc-500">
                No document boundary detected -- keeping the original framing.
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Rotate</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onRotate("left")}
                disabled={processing}
                aria-label="Rotate left"
                className="flex h-11 w-11 items-center justify-center rounded-md border border-zinc-300 disabled:opacity-50 dark:border-zinc-700"
              >
                ↺
              </button>
              <button
                type="button"
                onClick={() => onRotate("right")}
                disabled={processing}
                aria-label="Rotate right"
                className="flex h-11 w-11 items-center justify-center rounded-md border border-zinc-300 disabled:opacity-50 dark:border-zinc-700"
              >
                ↻
              </button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Enhancement</p>
            <div className="flex flex-wrap gap-2">
              {ENHANCEMENT_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => onEnhancementChange(m.value)}
                  disabled={processing}
                  aria-pressed={page.enhancement === m.value}
                  className={`min-h-11 rounded-md border px-3 text-sm font-medium disabled:opacity-50 ${
                    page.enhancement === m.value
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {onExtractText && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Text</p>
              <button
                type="button"
                onClick={onExtractText}
                disabled={processing || extractTextDisabled}
                className="min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
              >
                Extract text from this page
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={onResetToOriginal}
              disabled={processing || !isModified}
              className="min-h-11 rounded-md px-4 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Reset to original
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="min-h-11 rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Remove page
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 flex-1 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
