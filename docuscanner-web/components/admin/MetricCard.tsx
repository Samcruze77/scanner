const numberFormatter = new Intl.NumberFormat("en-US");

export function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
}) {
  const hasValue = typeof value === "number" && !Number.isNaN(value);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {hasValue ? numberFormatter.format(value as number) : 0}
        {suffix && hasValue ? suffix : ""}
      </p>
    </div>
  );
}
