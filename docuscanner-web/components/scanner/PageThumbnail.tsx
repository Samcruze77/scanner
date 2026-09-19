import type { ScannerPage } from "@/utils/scanner/page";
import { AnnotationOverlay } from "./AnnotationOverlay";

export function PageThumbnail({
  page,
  index,
  total,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  page: ScannerPage;
  index: number;
  total: number;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const processing = page.status === "detecting" || page.status === "processing";

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit page ${index + 1}`}
        className="relative block overflow-hidden rounded-md"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL, not a static asset next/image can optimize */}
        <img
          src={page.processedDataUrl}
          alt={`Page ${index + 1}`}
          className="aspect-[3/4] w-full object-cover"
        />
        <AnnotationOverlay page={page} fit="cover" />
        {processing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 px-1 text-center text-xs font-medium text-white">
            {page.statusLabel ?? "Processing…"}
          </div>
        )}
        {!processing && page.cropEnabled && (
          <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Cropped
          </span>
        )}
      </button>
      <div className="flex items-center justify-between gap-1 text-xs text-zinc-500">
        <span>Page {index + 1}</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label={`Move page ${index + 1} earlier`}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-zinc-200 disabled:opacity-30 dark:border-zinc-800"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label={`Move page ${index + 1} later`}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-zinc-200 disabled:opacity-30 dark:border-zinc-800"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove page ${index + 1}`}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-red-200 text-red-600 dark:border-red-900 dark:text-red-400"
          >
            ✕
          </button>
        </div>
      </div>
    </li>
  );
}
