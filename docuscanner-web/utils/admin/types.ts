// Shared types for the Super Admin analytics area, matching the VERIFIED
// live `admin-analytics` Edge Function contract:
//
//   GET {SUPABASE_URL}/functions/v1/admin-analytics?from=&to=&days=
//   Authorization: Bearer <caller's Supabase access token>
//   -> { role, range, overview, breakdowns, daily }
//
// The function is authenticated and checks public.admin_users server-side --
// `role` in the response is the sole source of truth for access; the app
// never derives it from client-side state.
//
// The exact keys *inside* overview/breakdowns/daily were not specified when
// this was verified, so those are typed loosely (Record<string, unknown> /
// unknown[]) and the UI renders them defensively rather than assuming named
// fields like "totalVisitors" that may not exist.

export type AdminRole = "super_admin" | "admin" | "analyst";

export interface AdminAnalyticsRange {
  from?: string;
  to?: string;
  days?: number;
  // Geographic + audience filters -- verified live against admin-analytics
  // (see supabase/functions/admin-analytics/index.ts). All optional; each
  // narrows overview/breakdowns/daily/geo consistently.
  // Canonical geography hierarchy (see supabase/functions/_shared/geoFields.ts):
  // country, state_province, city_town, county_district_lga, neighborhood_suburb.
  country?: string;
  state_province?: string;
  city_town?: string;
  county_district_lga?: string;
  neighborhood_suburb?: string;
  device?: string;
  visitorType?: "new" | "returning";
}

// Flat map of metric name -> number, shape not yet confirmed beyond that.
export type AdminAnalyticsOverview = Record<string, unknown>;

// Map of breakdown name (e.g. "country", "device") -> its rows, shape not
// yet confirmed beyond "some kind of list per breakdown".
export type AdminAnalyticsBreakdowns = Record<string, unknown>;

// `geo` IS a verified, concrete part of the admin-analytics contract (unlike
// overview/breakdowns above, kept loose for historical reasons) -- it's the
// per-country/region/city aggregation the Geography admin page renders.
export type AdminGeoField = "country" | "state_province" | "city_town" | "county_district_lga" | "neighborhood_suburb";
export type AdminGeoChildField = Exclude<AdminGeoField, "country">;

// Full path down to a node's level. A level with no value is null (never
// guessed); "Unknown" appears only as the country of events with no country.
export interface AdminGeoPath {
  country: string;
  state_province: string | null;
  city_town: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
}

export interface AdminGeoRow {
  key: string; // value at this node's own level (ISO country code, state/province code or name, city name, ...)
  path: AdminGeoPath;
  users: number;
  sessions: number;
  // Distinct descendants under this node, per deeper level.
  child_counts: Record<AdminGeoChildField, number>;
  regions: number; // == child_counts.state_province
  cities: number; // == child_counts.city_town
  opens: number;
  pdf_jobs: number;
  ad_impressions: number;
  ad_clicks: number;
  ctr: number | null;
  pct_users: number | null;
  pct_sessions: number | null;
}

export interface AdminGeoCityRow extends AdminGeoRow {
  region: string | null;
}

export interface AdminAnalyticsGeo {
  countries: AdminGeoRow[];
  // Every existing node at each level below country. Drill-down = filter by
  // path prefix; a value that isn't in the data can't be selected.
  levels: Record<AdminGeoChildField, AdminGeoRow[]>;
  regions_by_country: Record<string, AdminGeoRow[]>;
  cities_by_country: Record<string, AdminGeoCityRow[]>;
}

// One row of the "All users by location" detail table -- see
// supabase/functions/_shared/geoHierarchy.ts's buildLocationRows for why
// ad_impressions/ad_clicks live on a separate "ads" visitor_type row instead
// of being duplicated across the new/returning rows at the same location.
export type AdminVisitorType = "new" | "returning" | "unknown" | "ads";

export interface AdminLocationRow {
  date: string;
  country: string; // ISO code, or "Unknown"
  state_province: string | null;
  city_town: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
  device: string | null;
  visitor_type: AdminVisitorType;
  sessions: number;
  ad_impressions: number;
  ad_clicks: number;
}

export interface AdminAnalyticsResponse {
  role: AdminRole | null;
  range?: AdminAnalyticsRange;
  overview?: AdminAnalyticsOverview;
  breakdowns?: AdminAnalyticsBreakdowns;
  geo?: AdminAnalyticsGeo;
  locations?: AdminLocationRow[];
  locations_total_rows?: number;
  locations_truncated?: boolean;
  daily?: unknown[];
}

export interface DateRange {
  from: string; // ISO date (yyyy-mm-dd)
  to: string;
}

// --- Exports ---
//
// One backend serves every report and download: GET
// /api/admin/analytics-export (see app/api/admin/analytics-export/route.ts).
// The whole selection travels in the query string, so a report is a plain
// authenticated GET and every entry point (Export page, Geography, Analytics)
// shares the same implementation. PDF and email delivery are not implemented.

import type { AnalyticsFilters } from "../../supabase/functions/_shared/analyticsFilters.ts";
import type { ReportSummary } from "./geoReport.ts";

export type DownloadExportFormat = "csv" | "xlsx" | "json";
export type ExportFilters = Partial<Record<keyof AnalyticsFilters, string | null | undefined>>;

export interface ExportRequest {
  reportType: string;
  dateRange: DateRange;
  filters?: ExportFilters;
}

export interface ReportPreview {
  report_type: string;
  range: { from: string; to: string };
  filters: AnalyticsFilters;
  datasets: ("events" | "ads")[];
  summary: ReportSummary;
  report_rows: number | null;
}

export interface ExportOptions {
  campaigns: { id: string; name: string; status: string }[];
  creatives: { id: string; campaign_id: string; slot_code: string; title: string | null }[];
  slots: string[];
}
