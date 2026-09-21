import type { ScannerPage } from "@/utils/scanner/page";
import { PageThumbnail } from "./PageThumbnail";

// The pages as a strip under the preview. Choosing one shows it in the preview;
// reordering and removing act on the chosen page (see ScannerWorkspace).
export function PageList({
  pages,
  selectedId,
  onSelect,
}: {
  pages: ScannerPage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (pages.length === 0) return null;

  return (
    <ul aria-label="Pages" className="flex gap-2 overflow-x-auto pb-2">
      {pages.map((page, index) => (
        <PageThumbnail
          key={page.id}
          page={page}
          index={index}
          selected={page.id === selectedId}
          onSelect={() => onSelect(page.id)}
        />
      ))}
    </ul>
  );
}
