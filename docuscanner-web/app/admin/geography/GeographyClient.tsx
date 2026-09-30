"use client";

// The five-level hierarchy is the structure of this page:
//   Country -> State / Province -> City / Town -> County / District / LGA
//   -> Neighborhood / Suburb
// (canonical fields country, state_province, city_town, county_district_lga,
// neighborhood_suburb -- see supabase/functions/_shared/geoFields.ts).
// Every level has its own table and selector, built only from nodes that
// exist in the fetched data (never a hard-coded list, never specific to one
// country), and every number is real data from the SAME admin-analytics
// response the rest of the admin uses. A level the location provider doesn't
// supply shows an explicit "not available" state instead of made-up values.

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { getAdminAnalyticsBrowser } from "@/utils/admin/client.browser";
import { defaultDateRange, todayRange } from "@/utils/admin/dateRange";
import { buildExportPageUrl } from "@/utils/admin/exportClient";
import {
  CHILD_LEVELS,
  EMPTY_SELECTION,
  LEVELS,
  NOT_AVAILABLE,
  buildTree,
  countryLabel,
  isSelectedNode,
  nodeLabel,
  nodesUnder as nodesUnderFor,
  selectNode,
  valueAt,
  type LevelNodes,
  type Selection,
  type TreeNode,
} from "@/utils/admin/geoLevels";
import { regionName } from "@/utils/admin/location";
import { normalizeOverview } from "@/utils/admin/format";
import type { AdminAnalyticsResponse, AdminGeoChildField, AdminGeoField, AdminGeoRow, AdminLocationRow, DateRange } from "@/utils/admin/types";
import { MetricCard } from "@/components/admin/MetricCard";
import { GeoSelectors, selectClass } from "@/components/admin/GeoSelectors";

const PRESETS: { label: string; range: () => DateRange }[] = [
  { label: "Today", range: todayRange },
  { label: "7 days", range: () => defaultDateRange(7) },
  { label: "30 days", range: () => defaultDateRange(30) },
  { label: "90 days", range: () => defaultDateRange(90) },
];

const DEVICES = ["desktop", "mobile", "tablet"];

type SortKey = "users" | "sessions" | "ad_impressions" | "ad_clicks" | "ctr" | AdminGeoChildField;

const numberFormatter = new Intl.NumberFormat("en-US");

function fmt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return numberFormatter.format(value);
}

function fmtPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}

function sortValue(row: AdminGeoRow, key: SortKey): number {
  if (key === "users" || key === "sessions" || key === "ad_impressions" || key === "ad_clicks" || key === "ctr") {
    return row[key] ?? -Infinity;
  }
  return row.child_counts?.[key] ?? 0;
}

const inputClass = selectClass;

// A level the location provider did not supply is "Not available" -- distinct
// from "Unknown", which means an event with no country at all.
function Level({ value }: { value: string | null }) {
  return value ? <>{value}</> : <span className="text-xs italic text-zinc-400">{NOT_AVAILABLE}</span>;
}

function TreeList({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? nodes : nodes.slice(0, 10);
  return (
    <ul className={depth === 0 ? "space-y-1" : "ml-4 space-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-800"}>
      {visible.map((n) => {
        const label = LEVELS.find((l) => l.field === n.field)!.label;
        const line = (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{nodeLabel(n.field, n.row)}</span>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{fmt(n.row.users)} users</span>
            <span className="text-xs text-zinc-400">{label}</span>
          </span>
        );
        return (
          <li key={[n.field, n.row.path.country, n.row.path.state_province, n.row.path.city_town, n.row.path.county_district_lga, n.row.path.neighborhood_suburb].join("\u0001")} className="text-sm">
            {n.children.length > 0 ? (
              <details open={depth === 0 && nodes.length === 1}>
                <summary className="cursor-pointer select-none py-0.5">{line}</summary>
                <TreeList nodes={n.children} depth={depth + 1} />
              </details>
            ) : (
              <div className="py-0.5 pl-4">{line}</div>
            )}
          </li>
        );
      })}
      {nodes.length > 10 && (
        <li>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            {showAll ? "Show top 10" : `Show all ${nodes.length}`}
          </button>
        </li>
      )}
    </ul>
  );
}
const thClass = "cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right font-medium hover:text-zinc-900 dark:hover:text-zinc-100";

export function GeographyClient({
  initialRange,
  initialData,
  initialSelection = EMPTY_SELECTION,
  initialDevice = "",
  initialVisitorType = "",
}: {
  initialRange: DateRange;
  initialData: AdminAnalyticsResponse | null;
  // From a shared URL, e.g. /admin/geography?country=..&state=..&city=..&lga=..
  initialSelection?: Selection;
  initialDevice?: string;
  initialVisitorType?: string;
}) {
  const [range, setRange] = useState(initialRange);
  const [device, setDevice] = useState<string>(initialDevice);
  const [visitorType, setVisitorType] = useState<string>(initialVisitorType);
  const [data, setData] = useState<AdminAnalyticsResponse | null>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [countrySearch, setCountrySearch] = useState("");
  const [showAllCountries, setShowAllCountries] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("users");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // The one drill-down/filter state the page revolves around: set by
  // clicking a table row OR by the selectors -- both are the same action.
  const [selection, setSelection] = useState<Selection>(initialSelection);

  const [advertiserLevel, setAdvertiserLevel] = useState<AdminGeoField>("country");

  function refetch(next: { range?: DateRange; device?: string; visitorType?: string }) {
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
  const overviewValue = (key: string) => overview.find((o) => o.key === key)?.value ?? null;

  const allCountries = useMemo(() => data?.geo?.countries ?? [], [data]);
  const levelNodes = useMemo(
    () => ({
      country: allCountries,
      state_province: data?.geo?.levels?.state_province ?? [],
      city_town: data?.geo?.levels?.city_town ?? [],
      county_district_lga: data?.geo?.levels?.county_district_lga ?? [],
      neighborhood_suburb: data?.geo?.levels?.neighborhood_suburb ?? [],
    }),
    [data, allCountries],
  );
  const locationRows: AdminLocationRow[] = useMemo(() => data?.locations ?? [], [data]);

  const select = (field: AdminGeoField, row: AdminGeoRow | null) => setSelection((prev) => selectNode(prev, field, row));
  const nodesUnder = (field: AdminGeoField) => nodesUnderFor(levelNodes as LevelNodes, selection, field);
  const isSelected = (field: AdminGeoField, row: AdminGeoRow) => isSelectedNode(selection, field, row);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return allCountries;
    return allCountries.filter((c) => c.key.toLowerCase().includes(q) || countryLabel(c.key).toLowerCase().includes(q));
  }, [allCountries, countrySearch]);

  function sortRows(rows: AdminGeoRow[]): AdminGeoRow[] {
    return [...rows].sort((a, b) => {
      const diff = sortValue(b, sortKey) - sortValue(a, sortKey);
      return sortDir === "desc" ? diff : -diff;
    });
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "");

  const sortedCountries = sortRows(filteredCountries);
  const visibleCountries = showAllCountries ? sortedCountries : sortedCountries.slice(0, 20);

  // --- Advertiser Audience: same hierarchy, grouped by whichever level is
  // picked, scoped to the current selection so it always matches the tables.
  const topAdvertiserRows = useMemo(() => {
    const index = LEVELS.findIndex((l) => l.field === advertiserLevel);
    return levelNodes[advertiserLevel]
      .filter((row) =>
        LEVELS.slice(0, index).every((a) => !selection[a.field] || valueAt(row, a.field) === selection[a.field]),
      )
      .map((row) => ({
        // Deepest selected level first, up to the country: "Ikeja GRA, Ikeja, Lagos, Nigeria".
        label: LEVELS.slice(0, index + 1)
          .reverse()
          .map((l) => {
            if (l.field === "country") return countryLabel(row.path.country);
            const value = row.path[l.field];
            return value && l.field === "state_province" ? (regionName(row.path.country, value) ?? value) : value;
          })
          .filter(Boolean)
          .join(", "),
        row,
      }))
      .sort((a, b) => b.row.ad_impressions - a.row.ad_impressions || b.row.users - a.row.users)
      .slice(0, 15);
  }, [advertiserLevel, levelNodes, selection]);

  const filteredLocationRows = useMemo(
    () =>
      locationRows.filter((r) => {
        if (selection.country && r.country !== selection.country) return false;
        if (selection.state_province && r.state_province !== selection.state_province) return false;
        if (selection.city_town && r.city_town !== selection.city_town) return false;
        if (selection.county_district_lga && r.county_district_lga !== selection.county_district_lga) return false;
        if (selection.neighborhood_suburb && r.neighborhood_suburb !== selection.neighborhood_suburb) return false;
        return true;
      }),
    [locationRows, selection],
  );

  const visitorTypeLabel: Record<string, string> = { new: "New", returning: "Returning", unknown: "Unknown", ads: "Ad activity" };
  const anySelected = LEVELS.some((l) => selection[l.field]);

  // "Export this view" hands the exact current selection (range, device,
  // visitor type and every geography level) to /admin/exports, which shows a
  // preview and generates the report through the one shared export backend.
  const exportHref = buildExportPageUrl({
    reportType: "geography",
    dateRange: range,
    filters: {
      country: selection.country,
      state_province: selection.state_province,
      city_town: selection.city_town,
      county_district_lga: selection.county_district_lga,
      neighborhood_suburb: selection.neighborhood_suburb,
      device: device || undefined,
      visitor_type: visitorType === "new" || visitorType === "returning" ? visitorType : undefined,
    },
  });

  const tree = useMemo(() => buildTree(levelNodes as LevelNodes), [levelNodes]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Geography</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Country → State / Province → City / Town → County / District / LGA → Neighborhood / Suburb, derived
            server-side from request geolocation (never browser GPS). Approximate; a level appears only when the
            location provider supplies it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => refetch({ range: preset.range() })}
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
            className={inputClass}
          />
          <span className="text-sm text-zinc-400">to</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => refetch({ range: { ...range, to: e.target.value } })}
            className={inputClass}
          />
        </div>
      </div>

      {/* --- Location filters: one dependent selector per level, built only from real data --- */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-surface p-3 dark:border-zinc-800">
        <GeoSelectors nodes={levelNodes as LevelNodes} selection={selection} onChange={setSelection} />
        <select value={device} onChange={(e) => refetch({ device: e.target.value })} className={inputClass}>
          <option value="">All devices</option>
          {DEVICES.map((d) => (
            <option key={d} value={d}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </option>
          ))}
        </select>
        <select value={visitorType} onChange={(e) => refetch({ visitorType: e.target.value })} className={inputClass}>
          <option value="">New + returning</option>
          <option value="new">New visitors only</option>
          <option value="returning">Returning visitors only</option>
        </select>
        {anySelected && (
          <button type="button" onClick={() => select("country", null)} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            Clear location filters
          </button>
        )}
        <Link
          href={exportHref}
          className="ml-auto rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
        >
          Export this view
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {isPending && <p className="text-sm text-zinc-400">Loading…</p>}

      {/* --- Location Overview --- */}
      <section>
        <p className="mb-2 text-sm font-medium">Location overview</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <MetricCard label="Countries" value={overviewValue("countries") ?? allCountries.filter((c) => c.key !== "Unknown").length} />
          <MetricCard label="Users" value={overviewValue("unique_visitors")} />
          <MetricCard label="Sessions" value={overviewValue("sessions")} />
          <MetricCard label="Cities / towns" value={overviewValue("cities") ?? levelNodes.city_town.length} />
          <MetricCard label="Counties / districts" value={overviewValue("counties") ?? levelNodes.county_district_lga.length} />
          <MetricCard label="Neighborhoods" value={overviewValue("neighborhoods") ?? levelNodes.neighborhood_suburb.length} />
          <MetricCard label="Ad impressions" value={overviewValue("ad_impressions")} />
        </div>
      </section>

      {/* --- Hierarchy: users at every level that has real data, and which levels the provider supplies --- */}
      <section className="rounded-lg border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
        <p className="text-sm font-medium">Hierarchy</p>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Users at every level for this range. Only levels with data are listed.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {LEVELS.map((l) => {
            const count = levelNodes[l.field].filter((r) => !(l.field === "country" && r.key === "Unknown")).length;
            return (
              <span
                key={l.field}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${count > 0 ? "border-zinc-300 dark:border-zinc-700" : "border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700"}`}
              >
                {l.label}: {count > 0 ? fmt(count) : NOT_AVAILABLE}
              </span>
            );
          })}
        </div>
        {tree.length === 0 ? <p className="text-sm text-zinc-400">No geographic data yet</p> : <TreeList nodes={tree} />}
      </section>

      {/* --- Country table (always visible: the top of the hierarchy) --- */}
      <section className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm font-medium">
            Audience by country <span className="text-zinc-400">({sortedCountries.length})</span>
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search countries…"
              value={countrySearch}
              onChange={(e) => setCountrySearch(e.target.value)}
              className={inputClass}
            />
            {sortedCountries.length > 20 && (
              <button type="button" onClick={() => setShowAllCountries((v) => !v)} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                {showAllCountries ? "Show top 20" : `Show all ${sortedCountries.length} countries`}
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Country</th>
                <th onClick={() => toggleSort("users")} className={thClass}>Users{arrow("users")}</th>
                <th onClick={() => toggleSort("sessions")} className={thClass}>Sessions{arrow("sessions")}</th>
                {CHILD_LEVELS.map((l) => (
                  <th key={l.field} onClick={() => toggleSort(l.field)} className={thClass}>
                    {l.label}{arrow(l.field)}
                  </th>
                ))}
                <th onClick={() => toggleSort("ad_impressions")} className={thClass}>Ad impressions{arrow("ad_impressions")}</th>
                <th onClick={() => toggleSort("ad_clicks")} className={thClass}>Ad clicks{arrow("ad_clicks")}</th>
                <th onClick={() => toggleSort("ctr")} className={thClass}>CTR{arrow("ctr")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleCountries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-zinc-400">
                    No geographic data yet
                  </td>
                </tr>
              ) : (
                visibleCountries.map((row) => (
                  <tr
                    key={row.key}
                    onClick={() => (row.key === "Unknown" ? undefined : select("country", selection.country === row.key ? null : row))}
                    className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${row.key === "Unknown" ? "" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-950"} ${selection.country === row.key ? "bg-zinc-50 dark:bg-zinc-950" : ""}`}
                  >
                    <td className="px-4 py-2 font-medium">{countryLabel(row.key)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.users)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.sessions)}</td>
                    {CHILD_LEVELS.map((l) => (
                      <td key={l.field} className="px-4 py-2 text-right tabular-nums">
                        {row.key === "Unknown" ? "—" : fmt(row.child_counts?.[l.field])}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ad_impressions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ad_clicks)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtPct(row.ctr)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- One drill-down table per level below country. Shown once a country is chosen; rows are only
           values that exist in the data, and an empty level says so instead of inventing values. --- */}
      {selection.country &&
        CHILD_LEVELS.map((level, childIndex) => {
          const rows = sortRows(nodesUnder(level.field));
          const deeper = CHILD_LEVELS.slice(childIndex + 1);
          const trail = LEVELS.slice(0, childIndex + 2)
            .map((l) => {
              const chosen = selection[l.field];
              if (l.field === level.field) return l.label;
              if (!chosen) return l.label;
              return l.field === "country" ? countryLabel(chosen) : l.field === "state_province" ? (regionName(selection.country, chosen) ?? chosen) : chosen;
            })
            .join(" → ");
          return (
            <section key={level.field} className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
              <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
                <p className="text-sm font-medium">
                  {level.label} <span className="text-zinc-400">({rows.length})</span>
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{trail}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <th className="px-4 py-2 font-medium">{level.label}</th>
                      <th className="px-4 py-2 text-right font-medium">Users</th>
                      <th className="px-4 py-2 text-right font-medium">Sessions</th>
                      {deeper.map((l) => (
                        <th key={l.field} className="px-4 py-2 text-right font-medium">{l.label}</th>
                      ))}
                      <th className="px-4 py-2 text-right font-medium">Ad impressions</th>
                      <th className="px-4 py-2 text-right font-medium">Ad clicks</th>
                      <th className="px-4 py-2 text-right font-medium">CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6 + deeper.length} className="px-4 py-6 text-center text-zinc-400">
                          No {level.label} data available for this selection (the location provider did not supply it).
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr
                          key={[row.path.country, row.path.state_province, row.path.city_town, row.path.county_district_lga, row.path.neighborhood_suburb].join("\u0001")}
                          onClick={() => select(level.field, isSelected(level.field, row) ? null : row)}
                          className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-950 ${isSelected(level.field, row) ? "bg-zinc-50 dark:bg-zinc-950" : ""}`}
                        >
                          <td className="px-4 py-2 font-medium">{nodeLabel(level.field, row)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(row.users)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(row.sessions)}</td>
                          {deeper.map((l) => (
                            <td key={l.field} className="px-4 py-2 text-right tabular-nums">{fmt(row.child_counts?.[l.field])}</td>
                          ))}
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ad_impressions)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ad_clicks)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmtPct(row.ctr)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

      {/* --- All users by location: the detailed inspection table --- */}
      <section className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm font-medium">
            All users by location <span className="text-zinc-400">({fmt(filteredLocationRows.length)} rows)</span>
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Where traffic is actually coming from, by day. No IP addresses -- anonymized visitor/session identifiers only.
            {data?.locations_truncated ? ` Showing the top ${data.locations?.length ?? 0} of ${fmt(data.locations_total_rows)} combinations for this range. Use Export for the complete dataset.` : ""}
          </p>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Date</th>
                {LEVELS.map((l) => (
                  <th key={l.field} className="px-4 py-2 font-medium">{l.label}</th>
                ))}
                <th className="px-4 py-2 font-medium">Device</th>
                <th className="px-4 py-2 font-medium">Visitor type</th>
                <th className="px-4 py-2 text-right font-medium">Sessions</th>
                <th className="px-4 py-2 text-right font-medium">Ad impressions</th>
                <th className="px-4 py-2 text-right font-medium">Ad clicks</th>
              </tr>
            </thead>
            <tbody>
              {filteredLocationRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-6 text-center text-zinc-400">
                    No location activity for this range/filters yet.
                  </td>
                </tr>
              ) : (
                filteredLocationRows.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="px-4 py-2 tabular-nums">{r.date}</td>
                    <td className="px-4 py-2">{countryLabel(r.country)}</td>
                    <td className="px-4 py-2"><Level value={r.state_province ? (regionName(r.country, r.state_province) ?? r.state_province) : null} /></td>
                    <td className="px-4 py-2"><Level value={r.city_town} /></td>
                    <td className="px-4 py-2"><Level value={r.county_district_lga} /></td>
                    <td className="px-4 py-2"><Level value={r.neighborhood_suburb} /></td>
                    <td className="px-4 py-2">{r.device ?? "—"}</td>
                    <td className="px-4 py-2">{visitorTypeLabel[r.visitor_type] ?? r.visitor_type}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(r.sessions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(r.ad_impressions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(r.ad_clicks)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Advertiser Audience --- */}
      <section className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <p className="text-sm font-medium">Advertiser audience</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Where is the FreePDFScanner audience? Ranked by ad impressions -- share with advertisers targeting a specific market.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
            {LEVELS.map((level) => (
              <button
                key={level.field}
                type="button"
                onClick={() => setAdvertiserLevel(level.field)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${advertiserLevel === level.field ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>
        {topAdvertiserRows.length === 0 || topAdvertiserRows.every((c) => c.row.ad_impressions === 0) ? (
          <p className="p-4 text-sm text-zinc-400">No ad impressions recorded yet in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 text-right font-medium">Users</th>
                  <th className="px-4 py-2 text-right font-medium">Sessions</th>
                  <th className="px-4 py-2 text-right font-medium">Ad impressions</th>
                  <th className="px-4 py-2 text-right font-medium">Ad clicks</th>
                  <th className="px-4 py-2 text-right font-medium">CTR</th>
                </tr>
              </thead>
              <tbody>
                {topAdvertiserRows
                  .filter((r) => r.row.ad_impressions > 0)
                  .map(({ label, row }) => (
                    <tr key={label + row.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                      <td className="px-4 py-2 font-medium">{label}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(row.users)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(row.sessions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ad_impressions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(row.ad_clicks)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(row.ctr)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
