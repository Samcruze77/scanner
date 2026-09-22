"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { getAdminAnalyticsBrowser } from "@/utils/admin/client.browser";
import { defaultDateRange } from "@/utils/admin/dateRange";
import type { AdminAnalyticsResponse, DateRange } from "@/utils/admin/types";
import { humanizeKey, normalizeBreakdown, normalizeOverview, tryDailySeries } from "@/utils/admin/format";
import { MetricCard } from "@/components/admin/MetricCard";
import { BreakdownTable } from "@/components/admin/BreakdownTable";
import { MiniBarChart } from "@/components/admin/MiniBarChart";
import { DailyTable } from "@/components/admin/DailyTable";

const PRESETS: { label: string; days: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

export function DashboardClient({
  initialRange,
  initialData,
  onlineCount,
}: {
  initialRange: DateRange;
  initialData: AdminAnalyticsResponse | null;
  onlineCount: number | null;
}) {
  const [range, setRange] = useState(initialRange);
  const [data, setData] = useState<AdminAnalyticsResponse | null>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function applyRange(next: DateRange) {
    setRange(next);
    setError(null);
    startTransition(async () => {
      try {
        const res = await getAdminAnalyticsBrowser(next.from, next.to);
        setData(res);
      } catch {
        setError("Couldn't load analytics for this range.");
        setData(null);
      }
    });
  }

  const overview = normalizeOverview(data?.overview);
  const breakdownEntries = data?.breakdowns && typeof data.breakdowns === "object"
    ? Object.entries(data.breakdowns as Record<string, unknown>)
    : [];
  const dailySeries = tryDailySeries(data?.daily);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold">Analytics</h1>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyRange(defaultDateRange(preset.days))}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {preset.label}
            </button>
          ))}
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => applyRange({ ...range, from: e.target.value })}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
          />
          <span className="text-sm text-zinc-400">to</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => applyRange({ ...range, to: e.target.value })}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {isPending && <p className="text-sm text-zinc-400">Loading…</p>}

      {onlineCount !== null && (
        <Link
          href="/admin/live"
          className="flex items-center justify-between rounded-lg border border-zinc-200 bg-surface px-4 py-3 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-950"
        >
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="font-medium">{onlineCount}</span> user{onlineCount === 1 ? "" : "s"} online right now
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">View live →</span>
        </Link>
      )}

      {overview.length === 0 ? (
        <p className="text-sm text-zinc-400">No data yet</p>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {overview.map((entry) => (
            <MetricCard key={entry.key} label={entry.label} value={entry.value} />
          ))}
        </section>
      )}

      <section>
        {dailySeries ? (
          <MiniBarChart title="Daily" points={dailySeries} />
        ) : (
          <DailyTable daily={data?.daily} />
        )}
      </section>

      {breakdownEntries.length > 0 && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {breakdownEntries.map(([key, value]) => (
            <BreakdownTable key={key} title={humanizeKey(key)} rows={normalizeBreakdown(value)} />
          ))}
        </section>
      )}
    </div>
  );
}
