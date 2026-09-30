// Microsoft Clarity and Combined report rows.
//
// Two sources, kept distinct: FreePDFScanner's own database is the source of
// truth for product and ad analytics; Clarity is the source of truth for its
// own behavioural metrics. Every row carries `source` so nothing is passed off
// as coming from the other system, and a metric appears only on rows whose
// source actually measures it (other cells stay empty).
//
// Clarity rows are a rolling 1-3 day window and country-level only (the Data
// Export API has no state/city/county/neighbourhood dimension), so their
// state_province/city_town/county_district_lga/neighborhood_suburb cells are
// always empty. Those levels come only from FreePDFScanner's own pipeline.

import type { AdminProfileRecord } from "../../supabase/functions/_shared/adminProfile.ts";
import { profileColumns } from "../../supabase/functions/_shared/adminProfile.ts";
import { aliasFor, windowFor, type ClarityRequest, type ClarityRow } from "../clarity/api.ts";
import type { GeoReportRow } from "./geoReport.ts";
import { countryName, regionName } from "./location.ts";
import type { FlatRow } from "./exportFile.ts";

export const SOURCE_INTERNAL = "freepdfscanner";
export const SOURCE_CLARITY = "microsoft_clarity";

const CLARITY_ONLY = ["traffic_source", "medium", "utm_campaign", "channel", "url", "os"] as const;
const SHARED = [
  "source",
  "window_from",
  "window_to",
  "date",
  "country_code",
  "country",
  "state_province",
  "state_province_name",
  "city_town",
  "county_district_lga",
  "neighborhood_suburb",
  "postal_code",
  "location_source",
  "device",
  "browser",
  ...CLARITY_ONLY.filter((c) => c !== "os"),
  "os",
  "sessions",
  "users",
  "engagement_time",
  "page_views",
  "events",
  "ad_impressions",
  "ad_clicks",
  "conversions",
  "first_event_at",
  "last_event_at",
] as const;

export const CLARITY_ONLY_COLUMNS: readonly string[] = ["source", "window_from", "window_to", "country", "device", "browser", "os", "traffic_source", "medium", "utm_campaign", "channel", "url", "sessions", "users", "engagement_time"];

// Metric columns exactly as Clarity returned them, prefixed so they can't be
// mistaken for FreePDFScanner metrics.
export function clarityMetricColumns(rows: ClarityRow[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r.metrics)))].sort().map((k) => `clarity.${k}`);
}

export function clarityFlatRows(rows: ClarityRow[], request: ClarityRequest, now: Date = new Date()): FlatRow[] {
  const win = windowFor(request.numOfDays, now);
  return rows.map((row) => {
    const flat: FlatRow = { source: SOURCE_CLARITY, window_from: win.from, window_to: win.to, ...row.dimensions };
    for (const [key, value] of Object.entries(row.metrics)) {
      flat[`clarity.${key}`] = value;
      const alias = aliasFor(key);
      if (alias) flat[alias] = value;
    }
    return flat;
  });
}

// FreePDFScanner geography-report rows, labelled and mapped onto the shared
// columns. `visitors` is FreePDFScanner's distinct visitor_id count.
export function internalFlatRows(rows: GeoReportRow[]): FlatRow[] {
  return rows.map((r) => ({
    source: SOURCE_INTERNAL,
    date: r.date,
    country_code: r.country_code,
    country: r.country_code ? countryName(String(r.country_code)) : null,
    state_province: r.state_province,
    state_province_name: r.state_province ? regionName(r.country_code == null ? null : String(r.country_code), String(r.state_province)) : null,
    city_town: r.city_town,
    county_district_lga: r.county_district_lga,
    neighborhood_suburb: r.neighborhood_suburb,
    postal_code: r.postal_code,
    location_source: r.location_source,
    device: r.device_type,
    browser: r.browser,
    sessions: r.sessions,
    users: r.visitors,
    page_views: r.page_views,
    events: r.events,
    ad_impressions: r.ad_impressions,
    ad_clicks: r.ad_clicks,
    conversions: r.conversions,
    first_event_at: r.first_event_at,
    last_event_at: r.last_event_at,
  }));
}

export function clarityColumns(profile: AdminProfileRecord, rows: ClarityRow[]): string[] {
  return [...profileColumns(profile), ...CLARITY_ONLY_COLUMNS, ...clarityMetricColumns(rows)];
}

export function combinedColumns(profile: AdminProfileRecord, rows: ClarityRow[]): string[] {
  return [...profileColumns(profile), ...SHARED, ...clarityMetricColumns(rows)];
}

export function withProfile(rows: FlatRow[], profile: AdminProfileRecord): FlatRow[] {
  return rows.map((r) => ({ ...profile, ...r }));
}
