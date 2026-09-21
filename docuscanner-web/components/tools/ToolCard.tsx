import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icons";
import type { ToolDef } from "@/utils/tools/registry";

const TOOL_ICONS: Record<string, IconName> = {
  "pdf-editor": "document",
  "add-text": "text",
  annotate: "pen",
  draw: "pen",
  highlight: "highlight",
  "add-date": "history",
  checkmark: "check",
  "x-mark": "x",
  "sign-pdf": "signature",
  "add-signature": "signature",
  "upload-signature": "upload",
  "compress-pdf": "compress",
  "compress-image": "image",
  "compress-word": "compress",
  "compress-excel": "compress",
};

// One entry in the Tools hub. Tools that ask guests for a (free) account say so
// with a small badge instead of being hidden.
export function ToolCard({ tool }: { tool: ToolDef }) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="card group flex h-full min-h-14 items-start gap-3 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-800 dark:hover:bg-blue-950/30"
    >
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
      >
        <Icon name={TOOL_ICONS[tool.slug] ?? "document"} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="font-semibold">{tool.title}</span>
          {tool.requiresAuth && (
            <span className="shrink-0 rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 dark:border-zinc-700">
              Free account
            </span>
          )}
        </span>
        <span className="muted mt-0.5 block text-sm">{tool.body}</span>
      </span>
    </Link>
  );
}
