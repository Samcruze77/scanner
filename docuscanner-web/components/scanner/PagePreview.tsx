import type { ScannerPage } from "@/utils/scanner/page";
import { Icon } from "@/components/ui/icons";
import { AnnotationOverlay } from "./AnnotationOverlay";

// The document, large: the page you are working on, exactly as it will appear in the
// PDF (crop, enhancement and marks included). Pressing it opens the page editor.
export function PagePreview({
  page,
  index,
  total,
  onEdit,
  onPrevious,
  onNext,
}: {
  page: ScannerPage;
  index: number;
  total: number;
  onEdit: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const processing = page.status === "detecting" || page.status === "processing";
  const ratio = page.processedWidth / page.processedHeight;

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-100 p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">
          Page {index + 1} of {total}
        </p>
        {total > 1 && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onPrevious}
              disabled={index === 0}
              aria-label="Previous page"
              className="btn btn-icon btn-ghost"
            >
              <Icon name="chevron-left" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={index === total - 1}
              aria-label="Next page"
              className="btn btn-icon btn-ghost"
            >
              <Icon name="chevron-right" />
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit page ${index + 1}`}
        title="Open the page editor"
        className="relative mx-auto block overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-zinc-300 dark:ring-zinc-700"
        style={{ aspectRatio: `${page.processedWidth} / ${page.processedHeight}`, width: `min(100%, calc(60vh * ${ratio}))` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL, not a static asset next/image can optimize */}
        <img src={page.processedDataUrl} alt={`Page ${index + 1}`} className="h-full w-full object-contain" />
        <AnnotationOverlay page={page} />
        {processing && (
          <span
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-black/50 px-2 text-center text-sm font-medium text-white"
          >
            {page.statusLabel ?? "Processing…"}
          </span>
        )}
        {!processing && page.cropEnabled && (
          <span className="absolute bottom-2 left-2 rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white">
            Cropped
          </span>
        )}
      </button>
    </div>
  );
}
