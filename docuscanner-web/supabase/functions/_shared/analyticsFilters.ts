// Filter + date-range parsing shared by admin-analytics (dashboard) and
// admin-analytics-export, so a download is built from exactly the same
// selection the admin sees on screen. Pure: no network, no Deno globals.

import { UNKNOWN } from "./geoHierarchy.ts";

export interface AnalyticsFilters {
  country: string | null;
  state_province: string | null;
  city_town: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
  device: string | null;
  visitor_type: "new" | "returning" | null;
}

export interface FilterableRow {
  country_code: string | null;
  region: string | null;
  city: string | null;
  county_district_lga?: string | null;
  neighborhood_suburb?: string | null;
  device_type: string | null;
}

// `region` / `city` are accepted as legacy aliases of state_province /
// city_town so an older cached client keeps working during a rollout.
export function parseFilters(params: URLSearchParams): AnalyticsFilters {
  const text = (...names: string[]): string | null => {
    for (const name of names) {
      const value = params.get(name)?.trim();
      if (value) return value;
    }
    return null;
  };
  const visitorType = params.get("visitor_type");
  return {
    country: text("country")?.toUpperCase() ?? null,
    state_province: text("state_province", "region"),
    city_town: text("city_town", "city"),
    county_district_lga: text("county_district_lga"),
    neighborhood_suburb: text("neighborhood_suburb"),
    device: text("device"),
    visitor_type: visitorType === "new" || visitorType === "returning" ? visitorType : null,
  };
}

// Location + device filters (visitor_type needs history and is applied
// separately, and only to events -- ad rows carry no visitor id).
export function matchesFilters(row: FilterableRow, f: AnalyticsFilters): boolean {
  if (f.country && (row.country_code ?? UNKNOWN).toUpperCase() !== f.country) return false;
  if (f.state_province && row.region !== f.state_province) return false;
  if (f.city_town && row.city !== f.city_town) return false;
  if (f.county_district_lga && (row.county_district_lga ?? null) !== f.county_district_lga) return false;
  if (f.neighborhood_suburb && (row.neighborhood_suburb ?? null) !== f.neighborhood_suburb) return false;
  if (f.device && row.device_type !== f.device) return false;
  return true;
}

export type DateRangeResult =
  | { ok: true; from: Date; to: Date; toExclusive: Date }
  | { ok: false; error: string };

// `to` is a bare calendar date from the client (that day's UTC midnight), so
// the query runs to the start of the day AFTER it -- otherwise the whole
// `to` day (including "today" on the Today preset) would be excluded.
export function resolveRange(params: URLSearchParams, now: Date = new Date()): DateRangeResult {
  const days = Math.min(Math.max(Number(params.get("days") ?? "30"), 1), 365);
  const toParam = params.get("to");
  const fromParam = params.get("from");
  const to = toParam ? new Date(toParam) : now;
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return { ok: false, error: "Invalid date range" };
  }
  return { ok: true, from, to, toExclusive: new Date(to.getTime() + 24 * 60 * 60 * 1000) };
}
