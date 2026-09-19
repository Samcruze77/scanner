import type { DailyPoint } from "@/utils/admin/format";

// Dependency-free bar chart (no charting library added, per project
// constraints) for the daily trend view.
export function MiniBarChart({
  title,
  points,
}: {
  title: string;
  points: DailyPoint[] | undefined;
}) {
  const data = points ?? [];
  const max = Math.max(1, ...data.map((p) => p.value));
  const width = 600;
  const height = 160;
  const barGap = 4;
  const barWidth = data.length > 0 ? width / data.length - barGap : 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500">{title}</p>
      {data.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No data yet</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-40 w-full" role="img" aria-label={title}>
          {data.map((point, i) => {
            const barHeight = (point.value / max) * (height - 20);
            const x = i * (barWidth + barGap);
            const y = height - barHeight;
            return (
              <g key={`${point.date}-${i}`}>
                <rect
                  x={x}
                  y={y}
                  width={Math.max(barWidth, 1)}
                  height={barHeight}
                  rx={2}
                  className="fill-zinc-900 dark:fill-zinc-100"
                />
                <title>{`${point.date}: ${point.value}`}</title>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
