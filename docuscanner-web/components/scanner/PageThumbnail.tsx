import type { ScannerPage } from "@/utils/scanner/page";
import { AnnotationOverlay } from "./AnnotationOverlay";

export function PageThumbnail({
  page,
  index,
  selected,
  onSelect,
}: {
  page: ScannerPage;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const processing = page.status === "detecting" || page.status === "processing";

  return (
    <li className="shrink-0">
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Show page ${index + 1}`}
        aria-current={selected ? "true" : undefined}
        className={`relative block w-16 overflow-hidden rounded-lg border-2 bg-white sm:w-20 ${
          selected ? "border-blue-600" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL, not a static asset next/image can optimize */}
        <img src={page.processedDataUrl} alt="" className="aspect-[3/4] w-full object-cover" />
        <AnnotationOverlay page={page} fit="cover" />
        {processing && <span className="absolute inset-0 bg-black/40" />}
        <span className="absolute bottom-0.5 right-0.5 rounded bg-zinc-900/80 px-1.5 text-[11px] font-medium leading-5 text-white">
          {index + 1}
        </span>
      </button>
    </li>
  );
}
