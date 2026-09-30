// Row shape, column order and report plans for admin analytics exports.
// Shared by the admin-analytics-export Edge Function (which produces rows)
// and the Next.js download route (which serializes them to CSV/XLSX/JSON),
// so the column set is defined exactly once. Pure: no network, no Deno.
//
// Every value is copied from a real database column. A null/absent value is
// exported as an empty cell -- never a placeholder, never invented.

import type { AdminProfileRecord } from "./adminProfile.ts";

export const EXPORT_REPORT_TYPES = ["visitors", "sessions", "scans", "conversions", "downloads", "advertising", "geography", "full"] as const;
export type ExportReportType = (typeof EXPORT_REPORT_TYPES)[number];

export type ExportDataset = "events" | "ads";

export interface ReportPlan {
  datasets: ExportDataset[];
  // Restricts analytics_events to these event_name values; null = all events.
  eventNames: string[] | null;
}

// `adFiltersActive`: campaign/creative/slot filters exist only on ad events,
// so with any of them set analytics events can't be part of the report.
// Returns no datasets for a report that is analytics-events only (the caller
// turns that into a clear error rather than an empty file).
export function planFor(report: ExportReportType, adFiltersActive = false): ReportPlan {
  const plan = basePlan(report);
  return adFiltersActive ? { datasets: plan.datasets.filter((d) => d === "ads"), eventNames: null } : plan;
}

function basePlan(report: ExportReportType): ReportPlan {
  switch (report) {
    case "visitors":
      return { datasets: ["events"], eventNames: ["page_view", "app_open"] };
    case "sessions":
      return { datasets: ["events"], eventNames: null };
    case "scans":
      return { datasets: ["events"], eventNames: ["scan_started", "scan_completed"] };
    case "conversions":
      return { datasets: ["events"], eventNames: ["conversion_started", "conversion_completed"] };
    case "downloads":
      return { datasets: ["events"], eventNames: ["document_downloaded"] };
    case "advertising":
      return { datasets: ["ads"], eventNames: null };
    case "geography":
    case "full":
      return { datasets: ["events", "ads"], eventNames: null };
  }
}

export function parseReportType(value: string | null): ExportReportType | null {
  return (EXPORT_REPORT_TYPES as readonly string[]).includes(value ?? "") ? (value as ExportReportType) : null;
}

// Admin profile of the exporting admin: derived from the real rows by
// ./adminProfile.ts (every non-secret column, prefixed admin_/profile_/
// account_). It is attached to every record so a file read on its own still
// says who produced it.
export type AdminProfile = AdminProfileRecord;

// Stable column order. `country` (name), `state_province_name` and the
// human labels are added by the download route from the raw codes.
export const RECORD_FIELDS = [
  "record_type",
  "record_id",
  "occurred_at",
  "event_name",
  "visitor_id",
  "session_id",
  "user_id",
  "visitor_type",
  "path",
  "referrer",
  "campaign_id",
  "campaign_name",
  "creative_id",
  "slot_code",
  "impressions",
  "clicks",
  "conversions",
  "country_code",
  "state_province",
  "city_town",
  "county_district_lga",
  "neighborhood_suburb",
  "postal_code",
  "location_source",
  "device_type",
  "browser",
  "operating_system",
  "properties",
] as const;

export type RecordField = (typeof RECORD_FIELDS)[number];
export type ExportRecord = Record<RecordField, string | number | null>;

export interface EventSourceRow {
  id: number;
  event_name: string;
  visitor_id: string | null;
  session_id: string | null;
  user_id: string | null;
  path: string | null;
  referrer: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
  postal_code: string | null;
  location_source: string | null;
  device_type: string | null;
  browser: string | null;
  operating_system: string | null;
  properties: Record<string, unknown> | null;
  created_at: string;
}

export interface AdSourceRow {
  id: number;
  event_type: "impression" | "click";
  campaign_id: string | null;
  creative_id: string | null;
  slot_code: string | null;
  session_id: string | null;
  user_id: string | null;
  path: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
  postal_code: string | null;
  location_source: string | null;
  device_type: string | null;
  created_at: string;
}

export const EVENT_SELECT =
  "id,event_name,visitor_id,session_id,user_id,path,referrer,country_code,region,city,county_district_lga,neighborhood_suburb,postal_code,location_source,device_type,browser,operating_system,properties,created_at";
export const AD_SELECT =
  "id,event_type,campaign_id,creative_id,slot_code,session_id,user_id,path,country_code,region,city,county_district_lga,neighborhood_suburb,postal_code,location_source,device_type,created_at";

function blank(): ExportRecord {
  return Object.fromEntries(RECORD_FIELDS.map((f) => [f, null])) as ExportRecord;
}

export function eventToRecord(row: EventSourceRow, visitorType: "new" | "returning" | "unknown"): ExportRecord {
  return {
    ...blank(),
    record_type: "analytics_event",
    record_id: row.id,
    occurred_at: row.created_at,
    event_name: row.event_name,
    visitor_id: row.visitor_id,
    session_id: row.session_id,
    user_id: row.user_id,
    visitor_type: visitorType,
    path: row.path,
    referrer: row.referrer,
    conversions: row.event_name === "conversion_completed" ? 1 : 0,
    country_code: row.country_code,
    state_province: row.region,
    city_town: row.city,
    county_district_lga: row.county_district_lga,
    neighborhood_suburb: row.neighborhood_suburb,
    postal_code: row.postal_code,
    location_source: row.location_source,
    device_type: row.device_type,
    browser: row.browser,
    operating_system: row.operating_system,
    properties: row.properties && Object.keys(row.properties).length > 0 ? JSON.stringify(row.properties) : null,
  };
}

export function adToRecord(row: AdSourceRow, campaignNames: ReadonlyMap<string, string>): ExportRecord {
  return {
    ...blank(),
    record_type: "ad_event",
    record_id: row.id,
    occurred_at: row.created_at,
    event_name: row.event_type,
    session_id: row.session_id,
    user_id: row.user_id,
    path: row.path,
    campaign_id: row.campaign_id,
    campaign_name: (row.campaign_id && campaignNames.get(row.campaign_id)) || null,
    creative_id: row.creative_id,
    slot_code: row.slot_code,
    impressions: row.event_type === "impression" ? 1 : 0,
    clicks: row.event_type === "click" ? 1 : 0,
    country_code: row.country_code,
    state_province: row.region,
    city_town: row.city,
    county_district_lga: row.county_district_lga,
    neighborhood_suburb: row.neighborhood_suburb,
    postal_code: row.postal_code,
    location_source: row.location_source,
    device_type: row.device_type,
  };
}

// One page of an export: filtered records plus the cursor for the next page
// (null once the dataset is exhausted). `scanned` counts raw rows examined.
export interface ExportPage {
  profile: AdminProfile;
  dataset: ExportDataset;
  rows: ExportRecord[];
  next_after: number | null;
  scanned: number;
}
