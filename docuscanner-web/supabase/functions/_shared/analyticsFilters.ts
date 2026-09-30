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
  // Advertising filters. They only exist on ad events, so when any is set the
  // analytics-event dataset is excluded from a report (see planFor).
  campaign_id: string | null;
  creative_id: string | null;
  slot_code: string | null;
}

export interface FilterableRow {
  country_code: string | null;
  region: string | null;
  city: string | null;
  county_district_lga?: string | null;
  neighborhood_suburb?: string | null;
  device_type: string | null;
}

// Accepted spellings per canonical filter. Canonical names come first;
// `region`/`city` are the legacy database-style names, the rest are the short
// forms used in shareable page URLs (e.g. /admin/geography?state=..&lga=..).
const ALIASES = {
  state_province: ["state_province", "state", "province", "region"],
  city_town: ["city_town", "city", "town"],
  county_district_lga: ["county_district_lga", "lga", "county", "district"],
  neighborhood_suburb: ["neighborhood_suburb", "neighborhood", "neighbourhood", "suburb"],
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    state_province: text(...ALIASES.state_province),
    city_town: text(...ALIASES.city_town),
    county_district_lga: text(...ALIASES.county_district_lga),
    neighborhood_suburb: text(...ALIASES.neighborhood_suburb),
    device: text("device"),
    visitor_type: visitorType === "new" || visitorType === "returning" ? visitorType : null,
    campaign_id: uuidOrNull(text("campaign_id", "campaign")),
    creative_id: uuidOrNull(text("creative_id", "creative")),
    slot_code: text("slot_code", "slot")?.slice(0, 80) ?? null,
  };
}

function uuidOrNull(value: string | null): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

export function hasAdFilters(f: AnalyticsFilters): boolean {
  return !!(f.campaign_id || f.creative_id || f.slot_code);
}

export interface AdFilterableRow {
  campaign_id: string | null;
  creative_id: string | null;
  slot_code: string | null;
}

export function matchesAdFilters(row: AdFilterableRow, f: AnalyticsFilters): boolean {
  if (f.campaign_id && row.campaign_id !== f.campaign_id) return false;
  if (f.creative_id && row.creative_id !== f.creative_id) return false;
  if (f.slot_code && row.slot_code !== f.slot_code) return false;
  return true;
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

// Canonical query-string form of a parsed selection: what pages put in
// shareable URLs and what the export route forwards to the Edge Function.
// Null filters are omitted.
export function filtersToParams(f: AnalyticsFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) if (value) params.set(key, value);
  return params;
}
