// Pure Country -> State/Region -> City aggregation, shared by the
// admin-analytics Edge Function (Deno, imports this by relative path same
// as _shared/geo.ts) and tested directly by Node with zero framework/runtime
// dependencies -- see tests/analytics/geo-hierarchy.mjs. No network, no
// Deno/browser globals, no npm packages: data in, data out.
//
// This module owns GROUPING (which country/region/city an event belongs to,
// and how many users/sessions/ad numbers each level has). Human-readable
// NAMES for a country code or region code are a display concern and live in
// utils/admin/location.ts instead (which is Next.js/Node-only, since that's
// the only place the iso-3166-2 dataset is installed) -- this module always
// works with the raw codes/strings the database actually stores.

export const UNKNOWN = "Unknown";

export interface AnalyticsEventRow {
  event_name: string;
  visitor_id: string | null;
  session_id: string | null;
  user_id: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  device_type: string | null;
  created_at: string;
}

export interface AdEventRow {
  event_type: "impression" | "click";
  country_code: string | null;
  region: string | null;
  city: string | null;
  device_type: string | null;
  created_at: string;
}

const PDF_JOB_EVENTS = new Set(["scan_completed", "conversion_completed"]);
const OPEN_EVENTS = new Set(["page_view", "app_open"]);

export interface GeoAgg {
  users: Set<string>;
  sessions: Set<string>;
  regions: Set<string>;
  cities: Set<string>;
  opens: number;
  pdf_jobs: number;
  ad_impressions: number;
  ad_clicks: number;
}

export function newAgg(): GeoAgg {
  return { users: new Set(), sessions: new Set(), regions: new Set(), cities: new Set(), opens: 0, pdf_jobs: 0, ad_impressions: 0, ad_clicks: 0 };
}

export function applyEventToAgg(agg: GeoAgg, row: Pick<AnalyticsEventRow, "visitor_id" | "session_id" | "event_name" | "region" | "city">) {
  if (row.visitor_id) agg.users.add(row.visitor_id);
  if (row.session_id) agg.sessions.add(row.session_id);
  if (row.region) agg.regions.add(row.region);
  if (row.city) agg.cities.add(row.city);
  if (OPEN_EVENTS.has(row.event_name)) agg.opens += 1;
  if (PDF_JOB_EVENTS.has(row.event_name)) agg.pdf_jobs += 1;
}

export function applyAdEventToAgg(agg: GeoAgg, row: Pick<AdEventRow, "event_type" | "region" | "city">) {
  if (row.region) agg.regions.add(row.region);
  if (row.city) agg.cities.add(row.city);
  if (row.event_type === "impression") agg.ad_impressions += 1;
  if (row.event_type === "click") agg.ad_clicks += 1;
}

export interface GeoRow {
  key: string;
  users: number;
  sessions: number;
  regions: number;
  cities: number;
  opens: number;
  pdf_jobs: number;
  ad_impressions: number;
  ad_clicks: number;
  ctr: number | null;
  pct_users: number | null;
  pct_sessions: number | null;
}

export function toGeoRow(key: string, agg: GeoAgg, totalUsers: number, totalSessions: number): GeoRow {
  return {
    key,
    users: agg.users.size,
    sessions: agg.sessions.size,
    regions: agg.regions.size,
    cities: agg.cities.size,
    opens: agg.opens,
    pdf_jobs: agg.pdf_jobs,
    ad_impressions: agg.ad_impressions,
    ad_clicks: agg.ad_clicks,
    ctr: agg.ad_impressions > 0 ? Number(((agg.ad_clicks / agg.ad_impressions) * 100).toFixed(2)) : null,
    pct_users: totalUsers > 0 ? Number(((agg.users.size / totalUsers) * 100).toFixed(2)) : null,
    pct_sessions: totalSessions > 0 ? Number(((agg.sessions.size / totalSessions) * 100).toFixed(2)) : null,
  };
}

export interface CityRow extends GeoRow {
  region: string | null;
}

export interface GeoHierarchy {
  countries: GeoRow[];
  regionsByCountry: Record<string, GeoRow[]>;
  citiesByCountry: Record<string, CityRow[]>;
}

// Builds the full Country -> Region -> City tree in one pass over each
// dataset. A row with no country becomes "Unknown" at the country level and
// is never further split by region/city (there's nothing trustworthy to
// split it by). A row WITH a country but no region/city still counts at the
// country level -- it's just invisible to the region/city breakdowns, per
// "never discard an event for missing city/region".
export function buildGeoHierarchy(rows: AnalyticsEventRow[], adRows: AdEventRow[], totalUsers: number, totalSessions: number): GeoHierarchy {
  const countryAgg = new Map<string, GeoAgg>();
  const regionAgg = new Map<string, Map<string, GeoAgg>>();
  const cityAgg = new Map<string, Map<string, { region: string | null; agg: GeoAgg }>>();

  const touchCountry = (country: string) => {
    if (!countryAgg.has(country)) countryAgg.set(country, newAgg());
    return countryAgg.get(country)!;
  };
  const touchRegion = (country: string, region: string) => {
    if (!regionAgg.has(country)) regionAgg.set(country, new Map());
    const byRegion = regionAgg.get(country)!;
    if (!byRegion.has(region)) byRegion.set(region, newAgg());
    return byRegion.get(region)!;
  };
  const touchCity = (country: string, city: string, region: string | null) => {
    if (!cityAgg.has(country)) cityAgg.set(country, new Map());
    const byCity = cityAgg.get(country)!;
    if (!byCity.has(city)) byCity.set(city, { region, agg: newAgg() });
    return byCity.get(city)!.agg;
  };

  for (const row of rows) {
    const country = row.country_code ?? UNKNOWN;
    applyEventToAgg(touchCountry(country), row);
    if (row.region) applyEventToAgg(touchRegion(country, row.region), row);
    if (row.city) applyEventToAgg(touchCity(country, row.city, row.region), row);
  }

  for (const row of adRows) {
    const country = row.country_code ?? UNKNOWN;
    applyAdEventToAgg(touchCountry(country), row);
    if (row.region) applyAdEventToAgg(touchRegion(country, row.region), row);
    if (row.city) applyAdEventToAgg(touchCity(country, row.city, row.region), row);
  }

  const countries = [...countryAgg.entries()]
    .map(([key, agg]) => toGeoRow(key, agg, totalUsers, totalSessions))
    .sort((a, b) => b.users - a.users);

  const regionsByCountry: Record<string, GeoRow[]> = {};
  for (const [country, byRegion] of regionAgg) {
    regionsByCountry[country] = [...byRegion.entries()]
      .map(([key, agg]) => toGeoRow(key, agg, totalUsers, totalSessions))
      .sort((a, b) => b.users - a.users);
  }

  const citiesByCountry: Record<string, CityRow[]> = {};
  for (const [country, byCity] of cityAgg) {
    citiesByCountry[country] = [...byCity.entries()]
      .map(([key, { region, agg }]) => ({ ...toGeoRow(key, agg, totalUsers, totalSessions), region }))
      .sort((a, b) => b.users - a.users);
  }

  return { countries, regionsByCountry, citiesByCountry };
}

// --- "All users by location" detail table -----------------------------
//
// One row per (date, country, region, city, device, visitor_type) from
// analytics_events (sessions = distinct session_ids). ad_impressions/
// ad_clicks are NOT split by visitor_type -- ad_events carries no visitor_id
// / new-vs-returning signal to split by -- so they're attached to a
// separate synthetic "ads" row per (date, country, region, city, device)
// instead of being duplicated onto every visitor-type row at that location
// (which would double-count them the moment anyone sums the column). This
// keeps every number in the table real and independently summable: no
// fabricated split, nothing counted twice.

export type VisitorType = "new" | "returning" | "unknown" | "ads";

export interface LocationRow {
  date: string;
  country: string; // ISO code or "Unknown"
  region: string | null;
  city: string | null;
  device: string | null;
  visitor_type: VisitorType;
  sessions: number;
  ad_impressions: number;
  ad_clicks: number;
}

function locationKey(date: string, country: string, region: string | null, city: string | null, device: string | null): string {
  return [date, country, region ?? "", city ?? "", device ?? ""].join("\u0001");
}

export function buildLocationRows(
  rows: AnalyticsEventRow[],
  adRows: AdEventRow[],
  returningVisitorIds: ReadonlySet<string>,
): LocationRow[] {
  const sessionRows = new Map<string, { row: LocationRow; sessions: Set<string> }>();

  for (const row of rows) {
    const date = String(row.created_at).slice(0, 10);
    const country = row.country_code ?? UNKNOWN;
    const visitorType: VisitorType = !row.visitor_id ? "unknown" : returningVisitorIds.has(row.visitor_id) ? "returning" : "new";
    const key = `${locationKey(date, country, row.region, row.city, row.device_type)}\u0001${visitorType}`;
    let entry = sessionRows.get(key);
    if (!entry) {
      entry = {
        row: {
          date,
          country,
          region: row.region,
          city: row.city,
          device: row.device_type,
          visitor_type: visitorType,
          sessions: 0,
          ad_impressions: 0,
          ad_clicks: 0,
        },
        sessions: new Set(),
      };
      sessionRows.set(key, entry);
    }
    if (row.session_id) entry.sessions.add(row.session_id);
  }

  const adTotals = new Map<string, { row: LocationRow }>();
  for (const row of adRows) {
    const date = String(row.created_at).slice(0, 10);
    const country = row.country_code ?? UNKNOWN;
    const key = `${locationKey(date, country, row.region, row.city, row.device_type)}\u0001ads`;
    let entry = adTotals.get(key);
    if (!entry) {
      entry = {
        row: {
          date,
          country,
          region: row.region,
          city: row.city,
          device: row.device_type,
          visitor_type: "ads",
          sessions: 0,
          ad_impressions: 0,
          ad_clicks: 0,
        },
      };
      adTotals.set(key, entry);
    }
    if (row.event_type === "impression") entry.row.ad_impressions += 1;
    if (row.event_type === "click") entry.row.ad_clicks += 1;
  }

  const out: LocationRow[] = [];
  for (const { row, sessions } of sessionRows.values()) out.push({ ...row, sessions: sessions.size });
  for (const { row } of adTotals.values()) out.push(row);

  return out.sort((a, b) => b.sessions - a.sessions || b.ad_impressions - a.ad_impressions);
}
