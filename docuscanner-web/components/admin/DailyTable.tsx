import { cellValue, dailyColumns, humanizeKey } from "@/utils/admin/format";

// Fallback for the `daily` field when it doesn't reduce to a single-metric
// trend line (see tryDailySeries) -- renders whatever columns are present
// instead of guessing which one to chart.
export function DailyTable({ daily }: { daily: unknown[] | undefined }) {
  const rows = daily ?? [];
  const columns = dailyColumns(rows);

  return (
    <div className="rounded-lg border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Daily</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No data yet</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                {columns.map((col) => (
                  <th key={col} className="whitespace-nowrap py-1 pr-4 font-medium">
                    {humanizeKey(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-900">
                  {columns.map((col) => (
                    <td key={col} className="whitespace-nowrap py-1 pr-4 tabular-nums">
                      {cellValue(row, col)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
