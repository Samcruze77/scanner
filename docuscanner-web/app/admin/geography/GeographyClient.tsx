"use client";

// Country -> State/Region -> City is the primary structure of this page, not
// an incidental table among others. Every section below is built around
// that hierarchy: the country table drills into a region table, which
// drills into a city table; the top filter bar's Country/State-Region/City
// selectors are dependent on each other and built only from locations that
// actually appear in the fetched data (never a hard-coded list, and never
// Nigeria/US-specific); and every number is real production data from the
// SAME admin-analytics response other admin metrics already come from --
// there is no second/parallel analytics table here.

import { useCallback, useMemo, useState, useTransition } from "react";
import { getAdminAnalyticsBrowser } from "@/utils/admin/client.browser";
import { defaultDateRange, todayRange } from "@/utils/admin/dateRange";
import { countryName, formatFullLocation, regionName } from "@/utils/admin/location";
import { normalizeOverview } from "@/utils/admin/format";
import type { AdminAnalyticsResponse, AdminGeoRow, AdminLocationRow, DateRange } from "@/utils/admin/types";
import { MetricCard } from "@/components/admin/MetricCard";

const PRESETS: { label: string; range: () => DateRange }[] = [
  { label: "Today", range: todayRange },
  { label: "7 days", range: () => defaultDateRange(7) },
  { label: "30 days", range: () => defaultDateRange(30) },
  { label: "90 days", range: () => defaultDateRange(90) },
];

const DEVICES = ["desktop", "mobile", "tablet"];

type SortKey = "users" | "sessions" | "regions" | "cities" | "ad_impressions" | "ad_clicks" | "ctr";
type AdvertiserLevel = "country" | "region" | "city";

const numberFormatter = new Intl.NumberFormat("en-US");

function fmt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return numberFormatter.format(value);
}

function fmtPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}

// Human label for a country-table row's key ("Unknown" stays as-is).
function countryLabel(code: string): string {
  return code === "Unknown" ? "Unknown" : (countryName(code) ?? code);
}

const inputClass = "rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black disabled:opacity-50";

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

  // The one drill-down/filter state the whole page revolves around: set by
  // clicking a table row OR by the Country/State-Region/City selectors --
  // both are the same action, just two ways to reach it.
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);

  const [advertiserLevel, setAdvertiserLevel] = useState<AdvertiserLevel>("country");

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
  const regionsByCountry = useMemo(() => data?.geo?.regions_by_country ?? {}, [data]);
  const citiesByCountry = useMemo(() => data?.geo?.cities_by_country ?? {}, [data]);
  const locationRows: AdminLocationRow[] = useMemo(() => data?.locations ?? [], [data]);

  const regionsForSelectedCountry = useMemo(
    () => (selectedCountry ? (regionsByCountry[selectedCountry] ?? []) : []),
    [regionsByCountry, selectedCountry],
  );
  const citiesForSelectedCountry = useMemo(
    () => (selectedCountry ? (citiesByCountry[selectedCountry] ?? []) : []),
    [citiesByCountry, selectedCountry],
  );
  const citiesForSelectedRegion = useMemo(
    () => citiesForSelectedCountry.filter((c) => c.region === selectedRegion),
    [citiesForSelectedCountry, selectedRegion],
  );

  // --- Dependent selectors: options built only from what's actually in the
  // fetched data (never a hard-coded country/region/city list).
  function selectCountry(code: string | null) {
    setSelectedCountry(code);
    setSelectedRegion(null);
    setSelectedCity(null);
  }
  function selectRegion(key: string | null) {
    setSelectedRegion(key);
    setSelectedCity(null);
  }

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return allCountries;
    return allCountries.filter((c) => {
      const name = countryLabel(c.key).toLowerCase();
      return c.key.toLowerCase().includes(q) || name.includes(q);
    });
  }, [allCountries, countrySearch]);

  const sortRows = useCallback(
    <T extends AdminGeoRow>(rows: T[]): T[] => {
      const copy = [...rows];
      copy.sort((a, b) => {
        const av = a[sortKey] ?? -Infinity;
        const bv = b[sortKey] ?? -Infinity;
        return sortDir === "desc" ? bv - av : av - bv;
      });
      return copy;
    },
    [sortKey, sortDir],
  );

  const sortedCountries = useMemo(() => sortRows(filteredCountries), [filteredCountries, sortRows]);
  const visibleCountries = showAllCountries ? sortedCountries : sortedCountries.slice(0, 20);
  const sortedRegions = useMemo(() => sortRows(regionsForSelectedCountry), [regionsForSelectedCountry, sortRows]);
  const sortedCities = useMemo(() => sortRows(citiesForSelectedRegion), [citiesForSelectedRegion, sortRows]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // --- Location Overview cards --------------------------------------
  const countriesRepresented = overviewValue("countries") ?? allCountries.filter((c) => c.key !== "Unknown").length;
  const citiesRepresented =
    overviewValue("cities") ?? new Set(Object.values(citiesByCountry).flatMap((list) => list.map((c) => c.key))).size;

  // --- Advertiser Audience: same hierarchy, grouped by whichever level is
  // picked, scoped to the current Country/Region selection so it always
  // matches what the drill-down above is showing.
  interface AdvertiserRow {
    label: string;
    users: number;
    sessions: number;
    ad_impressions: number;
    ad_clicks: number;
    ctr: number | null;
  }
  const advertiserRows: AdvertiserRow[] = useMemo(() => {
    if (advertiserLevel === "country") {
      return allCountries.map((c) => ({ label: countryLabel(c.key), users: c.users, sessions: c.sessions, ad_impressions: c.ad_impressions, ad_clicks: c.ad_clicks, ctr: c.ctr }));
    }
    if (advertiserLevel === "region") {
      const scope = selectedCountry ? [selectedCountry] : Object.keys(regionsByCountry);
      return scope.flatMap((country) =>
        (regionsByCountry[country] ?? []).map((r) => ({
          label: formatFullLocation(country, r.key, null),
          users: r.users,
          sessions: r.sessions,
          ad_impressions: r.ad_impressions,
          ad_clicks: r.ad_clicks,
          ctr: r.ctr,
        })),
      );
    }
    const scope = selectedCountry ? [selectedCountry] : Object.keys(citiesByCountry);
    return scope.flatMap((country) =>
      (citiesByCountry[country] ?? [])
        .filter((c) => !selectedRegion || c.region === selectedRegion)
        .map((c) => ({
          label: formatFullLocation(country, c.region, c.key),
          users: c.users,
          sessions: c.sessions,
          ad_impressions: c.ad_impressions,
          ad_clicks: c.ad_clicks,
          ctr: c.ctr,
        })),
    );
  }, [advertiserLevel, allCountries, regionsByCountry, citiesByCountry, selectedCountry, selectedRegion]);
  const topAdvertiserRows = useMemo(
    () => [...advertiserRows].sort((a, b) => b.ad_impressions - a.ad_impressions || b.users - a.users).slice(0, 15),
    [advertiserRows],
  );

  // --- All users by location: the detailed date x location breakdown,
  // narrowed to whatever Country/Region/City is currently selected.
  const filteredLocationRows = useMemo(() => {
    return locationRows.filter((r) => {
      if (selectedCountry && r.country !== selectedCountry) return false;
      if (selectedRegion && r.region !== selectedRegion) return false;
      if (selectedCity && r.city !== selectedCity) return false;
      return true;
    });
  }, [locationRows, selectedCountry, selectedRegion, selectedCity]);

  const headers: { key: SortKey; label: string }[] = [
    { key: "users", label: "Users" },
    { key: "sessions", label: "Sessions" },
  ];

  const visitorTypeLabel: Record<string, string> = { new: "New", returning: "Returning", unknown: "Unknown", ads: "Ad activity" };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Geography</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Country → State/Region → City, derived server-side from request geolocation (never browser GPS). Approximate.
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

      {/* --- Location filters: dependent Country / State-Region / City selectors, built only from real data --- */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-surface p-3 dark:border-zinc-800">
        <select
          value={selectedCountry ?? ""}
          onChange={(e) => selectCountry(e.target.value || null)}
          className={inputClass}
        >
          <option value="">All Countries</option>
          {[...allCountries]
            .filter((c) => c.key !== "Unknown")
            .sort((a, b) => countryLabel(a.key).localeCompare(countryLabel(b.key)))
            .map((c) => (
              <option key={c.key} value={c.key}>
                {countryLabel(c.key)}
              </option>
            ))}
        </select>
        <select
          value={selectedRegion ?? ""}
          onChange={(e) => selectRegion(e.target.value || null)}
          disabled={!selectedCountry || regionsForSelectedCountry.length === 0}
          className={inputClass}
        >
          <option value="">{selectedCountry ? "All States / Regions" : "Select a country first"}</option>
          {[...regionsForSelectedCountry]
            .sort((a, b) => regionName(selectedCountry, a.key)!.localeCompare(regionName(selectedCountry, b.key) ?? b.key))
            .map((r) => (
              <option key={r.key} value={r.key}>
                {regionName(selectedCountry, r.key) ?? r.key}
              </option>
            ))}
        </select>
        <select
          value={selectedCity ?? ""}
          onChange={(e) => setSelectedCity(e.target.value || null)}
          disabled={!selectedRegion || citiesForSelectedRegion.length === 0}
          className={inputClass}
        >
          <option value="">{selectedRegion ? "All Cities" : "Select a state/region first"}</option>
          {[...citiesForSelectedRegion].sort((a, b) => a.key.localeCompare(b.key)).map((c) => (
            <option key={c.key} value={c.key}>
              {c.key}
            </option>
          ))}
        </select>
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
        {(selectedCountry || selectedRegion || selectedCity) && (
          <button type="button" onClick={() => selectCountry(null)} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
            Clear location filters
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {isPending && <p className="text-sm text-zinc-400">Loading…</p>}

      {/* --- Location Overview --- */}
      <section>
        <p className="mb-2 text-sm font-medium">Location overview</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Countries" value={countriesRepresented} />
          <MetricCard label="Users" value={overviewValue("unique_visitors")} />
          <MetricCard label="Sessions" value={overviewValue("sessions")} />
          <MetricCard label="Cities" value={citiesRepresented} />
          <MetricCard label="Ad impressions" value={overviewValue("ad_impressions")} />
          <MetricCard label="Ad clicks" value={overviewValue("ad_clicks")} />
        </div>
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
                {headers.map((h) => (
                  <th key={h.key} onClick={() => toggleSort(h.key)} className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right font-medium hover:text-zinc-900 dark:hover:text-zinc-100">
                    {h.label}
                    {sortKey === h.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
                <th onClick={() => toggleSort("regions")} className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right font-medium hover:text-zinc-900 dark:hover:text-zinc-100">
                  States/Regions{sortKey === "regions" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
                <th onClick={() => toggleSort("cities")} className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right font-medium hover:text-zinc-900 dark:hover:text-zinc-100">
                  Cities{sortKey === "cities" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
                <th onClick={() => toggleSort("ad_impressions")} className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right font-medium hover:text-zinc-900 dark:hover:text-zinc-100">
                  Ad impressions{sortKey === "ad_impressions" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
                <th onClick={() => toggleSort("ad_clicks")} className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right font-medium hover:text-zinc-900 dark:hover:text-zinc-100">
                  Ad clicks{sortKey === "ad_clicks" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
                <th onClick={() => toggleSort("ctr")} className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right font-medium hover:text-zinc-900 dark:hover:text-zinc-100">
                  CTR{sortKey === "ctr" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleCountries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-zinc-400">
                    No geographic data yet
                  </td>
                </tr>
              ) : (
                visibleCountries.map((row: AdminGeoRow) => (
                  <tr
                    key={row.key}
                    onClick={() => (row.key === "Unknown" ? undefined : selectCountry(selectedCountry === row.key ? null : row.key))}
                    className={`border-b border-zinc-100 last:border-0 dark:border-zinc-900 ${row.key === "Unknown" ? "" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-950"} ${selectedCountry === row.key ? "bg-zinc-50 dark:bg-zinc-950" : ""}`}
                  >
                    <td className="px-4 py-2 font-medium">{countryLabel(row.key)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.users)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.sessions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.key === "Unknown" ? "—" : fmt(row.regions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.key === "Unknown" ? "—" : fmt(row.cities)}</td>
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

      {/* --- Region table: Country -> State/Region --- */}
      {selectedCountry && (
        <section className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm font-medium">
              Audience in {countryLabel(selectedCountry)} <span className="text-zinc-400">({sortedRegions.length} states/regions)</span>
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{countryLabel(selectedCountry)} → State/Region</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-2 font-medium">State / Region</th>
                  <th className="px-4 py-2 text-right font-medium">Users</th>
                  <th className="px-4 py-2 text-right font-medium">Sessions</th>
                  <th className="px-4 py-2 text-right font-medium">Cities</th>
                  <th className="px-4 py-2 text-right font-medium">Ad impressions</th>
                  <th className="px-4 py-2 text-right font-medium">Ad clicks</th>
                  <th className="px-4 py-2 text-right font-medium">CTR</th>
                </tr>
              </thead>
              <tbody>
                {sortedRegions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                      No state/region-level data available for this country.
                    </td>
                  </tr>
                ) : (
                  sortedRegions.map((r) => (
                    <tr
                      key={r.key}
                      onClick={() => selectRegion(selectedRegion === r.key ? null : r.key)}
                      className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-950 ${selectedRegion === r.key ? "bg-zinc-50 dark:bg-zinc-950" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium">{regionName(selectedCountry, r.key) ?? r.key}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.users)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.sessions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.cities)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.ad_impressions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.ad_clicks)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(r.ctr)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- City table: Country -> State/Region -> City --- */}
      {selectedCountry && selectedRegion && (
        <section className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm font-medium">
              Audience in {regionName(selectedCountry, selectedRegion) ?? selectedRegion} <span className="text-zinc-400">({sortedCities.length} cities)</span>
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {countryLabel(selectedCountry)} → {regionName(selectedCountry, selectedRegion) ?? selectedRegion} → City
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-2 font-medium">City</th>
                  <th className="px-4 py-2 text-right font-medium">Users</th>
                  <th className="px-4 py-2 text-right font-medium">Sessions</th>
                  <th className="px-4 py-2 text-right font-medium">Ad impressions</th>
                  <th className="px-4 py-2 text-right font-medium">Ad clicks</th>
                  <th className="px-4 py-2 text-right font-medium">CTR</th>
                </tr>
              </thead>
              <tbody>
                {sortedCities.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-400">
                      No city-level data available for this state/region.
                    </td>
                  </tr>
                ) : (
                  sortedCities.map((c) => (
                    <tr
                      key={c.key}
                      onClick={() => setSelectedCity((prev) => (prev === c.key ? null : c.key))}
                      className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-950 ${selectedCity === c.key ? "bg-zinc-50 dark:bg-zinc-950" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium">{c.key}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(c.users)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(c.sessions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(c.ad_impressions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(c.ad_clicks)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(c.ctr)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- All users by location: the detailed inspection table --- */}
      <section className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm font-medium">
            All users by location <span className="text-zinc-400">({fmt(filteredLocationRows.length)} rows)</span>
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Where traffic is actually coming from, by day. No IP addresses -- anonymized visitor/session identifiers only.
            {data?.locations_truncated ? ` Showing the top ${data.locations?.length ?? 0} of ${fmt(data.locations_total_rows)} combinations for this range.` : ""}
          </p>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Country</th>
                <th className="px-4 py-2 font-medium">State / Region</th>
                <th className="px-4 py-2 font-medium">City</th>
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
                  <td colSpan={9} className="px-4 py-6 text-center text-zinc-400">
                    No location activity for this range/filters yet.
                  </td>
                </tr>
              ) : (
                filteredLocationRows.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="px-4 py-2 tabular-nums">{r.date}</td>
                    <td className="px-4 py-2">{countryLabel(r.country)}</td>
                    <td className="px-4 py-2">{regionName(r.country, r.region) ?? "—"}</td>
                    <td className="px-4 py-2">{r.city ?? "—"}</td>
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
          <div className="flex items-center gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
            {(["country", "region", "city"] as AdvertiserLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setAdvertiserLevel(level)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${advertiserLevel === level ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}
              >
                {level === "country" ? "Country" : level === "region" ? "State/Region" : "City"}
              </button>
            ))}
          </div>
        </div>
        {topAdvertiserRows.length === 0 || topAdvertiserRows.every((c) => c.ad_impressions === 0) ? (
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
                  .filter((r) => r.ad_impressions > 0)
                  .map((r) => (
                    <tr key={r.label} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                      <td className="px-4 py-2 font-medium">{r.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.users)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.sessions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.ad_impressions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(r.ad_clicks)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtPct(r.ctr)}</td>
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
