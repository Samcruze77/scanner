import Link from "next/link";
import type { ToolDef } from "@/utils/tools/registry";

// One entry in the Tools hub. Tools that ask guests for a (free) account say so
// with a small badge instead of being hidden.
export function ToolCard({ tool }: { tool: ToolDef }) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="block h-full min-h-11 rounded-lg border border-zinc-200 p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-semibold">{tool.title}</span>
        {tool.requiresAuth && (
          <span className="shrink-0 rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700">
            Free account
          </span>
        )}
      </span>
      <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">{tool.body}</span>
    </Link>
  );
}
