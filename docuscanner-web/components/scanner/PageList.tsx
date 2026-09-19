import type { ScannerPage } from "@/utils/scanner/page";
import { PageThumbnail } from "./PageThumbnail";

export function PageList({
  pages,
  onEdit,
  onRemove,
  onMove,
}: {
  pages: ScannerPage[];
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}) {
  if (pages.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No pages yet. Use the camera, or upload a photo or PDF, to add your first page.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {pages.map((page, index) => (
        <PageThumbnail
          key={page.id}
          page={page}
          index={index}
          total={pages.length}
          onEdit={() => onEdit(page.id)}
          onRemove={() => onRemove(page.id)}
          onMoveUp={() => onMove(page.id, "up")}
          onMoveDown={() => onMove(page.id, "down")}
        />
      ))}
    </ul>
  );
}
