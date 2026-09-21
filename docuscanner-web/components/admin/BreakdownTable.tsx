import type { BreakdownRow } from "@/utils/admin/format";

export function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No data yet</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.slice(0, 8).map((row, i) => (
            <li key={`${row.label}-${i}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-zinc-700 dark:text-zinc-300">{row.label}</span>
              <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                {row.value ?? "—"}
                {total > 0 && row.value != null ? ` (${Math.round((row.value / total) * 100)}%)` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
