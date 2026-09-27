"use client";

import { useMemo, useState, useTransition } from "react";
import { getAdminAnalyticsBrowser } from "@/utils/admin/client.browser";
import { defaultDateRange } from "@/utils/admin/dateRange";
import { countryFlag, countryName } from "@/utils/admin/location";
import { normalizeOverview } from "@/utils/admin/format";
import type { AdminAnalyticsResponse, AdminGeoRow, DateRange } from "@/utils/admin/types";
import { MetricCard } from "@/components/admin/MetricCard";

const PRESETS: { label: string; days: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

const DEVICES = ["desktop", "mobile", "tablet"];

type SortKey = "users" | "sessions" | "opens" | "pdf_jobs" | "ad_impressions" | "ad_clicks" | "ctr";

const numberFormatter = new Intl.NumberFormat("en-US");

function fmt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return numberFormatter.format(value);
}

function fmtPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}

export function GeographyClient({
  initialRange,
  initialData,
}: {
  initialRange: DateRange;
  initialData: AdminAnalyticsResponse | null;
}) {
  const [range, setRange] = useState(initialRange);
  const [device, setDevice] = useState<string>("");
  const [visitorType, setVisitorType] = useState<string>("");
  const [data, setData] = useState<AdminAnalyticsResponse | null>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [countrySearch, setCountrySearch] = useState("");
  const [showAllCountries, setShowAllCountries] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("users");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);

  function refetch(next: {
    range?: DateRange;
    device?: string;
    visitorType?: string;
  }) {
    const nextRange = next.range ?? range;
    const nextDevice = next.device ?? device;
    const nextVisitorType = next.visitorType ?? visitorType;
    setRange(nextRange);
    setDevice(nextDevice);
    setVisitorType(nextVisitorType);
    setError(null);
    startTransition(async () => {
      try {
        const res = await getAdminAnalyticsBrowser(nextRange.from, nextRange.to, undefined, {
          device: nextDevice || undefined,
          visitorType: nextVisitorType === "new" || nextVisitorType === "returning" ? nextVisitorType : undefined,
        });
        setData(res);
      } catch {
        setError("Couldn't load geographic analytics for this range.");
        setData(null);
      }
    });
  }

  const overview = normalizeOverview(data?.overview);
  const allCountries = useMemo(() => data?.geo?.countries ?? [], [data]);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return allCountries;
    return allCountries.filter((c) => {
      const name = (countryName(c.key) ?? c.key).toLowerCase();
      return c.key.toLowerCase().includes(q) || name.includes(q);
    });
  }, [allCountries, countrySearch]);

  const sortedCountries = useMemo(() => {
    const copy = [...filteredCountries];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return copy;
  }, [filteredCountries, sortKey, sortDir]);

  const visibleCountries = showAllCountries ? sortedCountries : sortedCountries.slice(0, 20);
  const maxUsers = Math.max(1, ...allCountries.map((c) => c.users));

  const regions = selectedCountry ? data?.geo?.regions_by_country?.[selectedCountry] ?? [] : [];
  const cities = selectedCountry
    ? (data?.geo?.cities_by_country?.[selectedCountry] ?? []).filter((c) => !selectedRegion || c.region === selectedRegion)
    : [];

  const topByAdImpressions = useMemo(
    () => [...allCountries].sort((a, b) => b.ad_impressions - a.ad_impressions).slice(0, 10),
    [allCountries],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function selectCountry(code: string) {
    setSelectedCountry((prev) => (prev === code ? null : code));
    setSelectedRegion(null);
  }

  const headers: { key: SortKey; label: string }[] = [
    { key: "users", label: "Users" },
    { key: "sessions", label: "Sessions" },
    { key: "opens", label: "Opens" },
    { key: "pdf_jobs", label: "PDF jobs" },
    { key: "ad_impressions", label: "Impressions" },
    { key: "ad_clicks", label: "Clicks" },
    { key: "ctr", label: "CTR" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Geography</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Location is derived server-side from request geolocation (never browser GPS) and is approximate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => refetch({ range: defaultDateRange(preset.days) })}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {preset.label}
            </button>
          ))}
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => refetch({ range: { ...range, from: e.target.value } })}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
          />
          <span className="text-sm text-zinc-400">to</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => refetch({ range: { ...range, to: e.target.value } })}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={device}
          onChange={(e) => refetch({ device: e.target.value })}
          className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
        >
          <option value="">All devices</option>
          {DEVICES.map((d) => (
            <option key={d} value={d}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={visitorType}
          onChange={(e) => refetch({ visitorType: e.target.value })}
          className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
        >
          <option value="">New + returning</option>
          <option value="new">New visitors only</option>
          <option value="returning">Returning visitors only</option>
        </select>
        <input
          type="text"
          placeholder="Search countries…"
          value={countrySearch}
          onChange={(e) => setCountrySearch(e.target.value)}
          className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {isPending && <p className="text-sm text-zinc-400">Loading…</p>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Users" value={overview.find((o) => o.key === "unique_visitors")?.value} />
        <MetricCard label="Sessions" value={overview.find((o) => o.key === "sessions")?.value} />
        <MetricCard label="Page/app opens" value={overview.find((o) => o.key === "opens")?.value} />
        <MetricCard label="PDF jobs" value={overview.find((o) => o.key === "pdf_jobs")?.value} />
        <MetricCard label="Ad impressions" value={overview.find((o) => o.key === "ad_impressions")?.value} />
        <MetricCard label="Ad clicks" value={overview.find((o) => o.key === "ad_clicks")?.value} />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm font-medium">
            Countries <span className="text-zinc-400">({sortedCountries.length})</span>
          </p>
          {sortedCountries.length > 20 && (
            <button
              type="button"
              onClick={() => setShowAllCountries((v) => !v)}
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {showAllCountries ? "Show top 20" : `Show all ${sortedCountries.length} countries`}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Country</th>
                {headers.map((h) => (
                  <th
                    key={h.key}
                    onClick={() => toggleSort(h.key)}
                    className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right font-medium hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {h.label}
                    {sortKey === h.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">% users</th>
                <th className="px-4 py-2 text-right font-medium">% sessions</th>
              </tr>
            </thead>
            <tbody>
              {visibleCountries.length === 0 ? (
                <tr>
                  <td colSpan={headers.length + 3} className="px-4 py-6 text-center text-zinc-400">
                    No geographic data yet
                  </td>
                </tr>
              ) : (
                visibleCountries.map((row: AdminGeoRow) => (
                  <tr
                    key={row.key}
                    onClick={() => (row.key === "Unknown" ? undefined : selectCountry(row.key))}
                    className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${
                      row.key === "Unknown" ? "" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-950"
                    } ${selectedCountry === row.key ? "bg-zinc-50 dark:bg-zinc-950" : ""}`}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span>{row.key === "Unknown" ? "🌐" : countryFlag(row.key) ?? ""}</span>
                        <span className="font-medium">{row.key === "Unknown" ? "Unknown" : countryName(row.key) ?? row.key}</span>
                        <span className="text-xs text-zinc-400">{row.key !== "Unknown" ? row.key : ""}</span>
                      </div>
                      <div className="mt-1 h-1 w-full max-w-[160px] rounded-full bg-zinc-100 dark:bg-zinc-900">
                        <div
                          className="h-1 rounded-full bg-blue-500"
                          style={{ width: `${Math.max(2, (row.users / maxUsers) * 100)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.users)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.sessions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.opens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.pdf_jobs)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ad_impressions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ad_clicks)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtPct(row.ctr)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtPct(row.pct_users)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtPct(row.pct_sessions)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCountry && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
            <p className="text-sm font-medium">
              Regions in {countryName(selectedCountry) ?? selectedCountry}
            </p>
            {regions.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-400">No region-level data available for this country.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {regions.map((r) => (
                  <li
                    key={r.key}
                    onClick={() => setSelectedRegion((prev) => (prev === r.key ? null : r.key))}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-950 ${
                      selectedRegion === r.key ? "bg-zinc-50 dark:bg-zinc-950" : ""
                    }`}
                  >
                    <span className="truncate text-zinc-700 dark:text-zinc-300">{r.key}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                      {fmt(r.users)} users · {fmt(r.ad_impressions)} impr.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
            <p className="text-sm font-medium">
              Cities {selectedRegion ? `in ${selectedRegion}` : `in ${countryName(selectedCountry) ?? selectedCountry}`}
            </p>
            {cities.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-400">No city-level data available for this selection.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {cities.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-zinc-700 dark:text-zinc-300">
                      {c.key}
                      {c.region ? <span className="text-zinc-400"> · {c.region}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                      {fmt(c.users)} users · {fmt(c.ad_impressions)} impr.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
        <p className="text-sm font-medium">Advertiser audience by country</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Ranked by ad impressions in this range -- share with advertisers targeting a specific market.
        </p>
        {topByAdImpressions.length === 0 || topByAdImpressions.every((c) => c.ad_impressions === 0) ? (
          <p className="mt-3 text-sm text-zinc-400">No ad impressions recorded yet in this range.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {topByAdImpressions
              .filter((c) => c.ad_impressions > 0)
              .map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                    <span>{c.key === "Unknown" ? "🌐" : countryFlag(c.key) ?? ""}</span>
                    {c.key === "Unknown" ? "Unknown" : countryName(c.key) ?? c.key}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                    {fmt(c.users)} users · {fmt(c.ad_impressions)} ad impressions · {fmt(c.ad_clicks)} clicks
                    {c.ctr != null ? ` · ${c.ctr}% CTR` : ""}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
