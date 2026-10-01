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
  region: string | null; // canonical: state_province
  city: string | null; // canonical: city_town
  county_district_lga?: string | null;
  neighborhood_suburb?: string | null;
  device_type: string | null;
  created_at: string;
  // Number of identical events this row stands for (admin_analytics_event_groups collapses them in SQL).
  n?: number;
}

export interface AdEventRow {
  event_type: "impression" | "click";
  country_code: string | null;
  region: string | null;
  city: string | null;
  county_district_lga?: string | null;
  neighborhood_suburb?: string | null;
  device_type: string | null;
  created_at: string;
  n?: number;
}

export const weightOf = (row: { n?: number }): number => row.n ?? 1;

const PDF_JOB_EVENTS = new Set(["scan_completed", "conversion_completed"]);
const OPEN_EVENTS = new Set(["page_view", "app_open"]);

// --- Generic five-level hierarchy ----------------------------------------
//
// Country -> State/Province -> City/Town -> County/District/LGA ->
// Neighborhood/Suburb. A node is identified by the FULL path down to its
// level (so two towns with the same name in different states are different
// nodes), and only exists if some event actually carried that value -- no
// level is ever synthesized. An event is counted at every level it has a
// value for; a missing intermediate level does not stop deeper ones from
// counting (its path entry is simply null).

export type ChildField = "state_province" | "city_town" | "county_district_lga" | "neighborhood_suburb";
const CHILD_FIELDS: ChildField[] = ["state_province", "city_town", "county_district_lga", "neighborhood_suburb"];

export interface GeoPath {
  country: string; // ISO code, or "Unknown"
  state_province: string | null;
  city_town: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
}

type GeoLocationInput = {
  country_code: string | null;
  region: string | null;
  city: string | null;
  county_district_lga?: string | null;
  neighborhood_suburb?: string | null;
};

export function pathOf(row: GeoLocationInput): GeoPath {
  return {
    country: row.country_code ?? UNKNOWN,
    state_province: row.region || null,
    city_town: row.city || null,
    county_district_lga: row.county_district_lga || null,
    neighborhood_suburb: row.neighborhood_suburb || null,
  };
}

export interface GeoAgg {
  users: Set<string>;
  sessions: Set<string>;
  children: Record<ChildField, Set<string>>;
  opens: number;
  pdf_jobs: number;
  ad_impressions: number;
  ad_clicks: number;
}

export function newAgg(): GeoAgg {
  return {
    users: new Set(),
    sessions: new Set(),
    children: { state_province: new Set(), city_town: new Set(), county_district_lga: new Set(), neighborhood_suburb: new Set() },
    opens: 0,
    pdf_jobs: 0,
    ad_impressions: 0,
    ad_clicks: 0,
  };
}

export interface GeoRow {
  key: string; // the value at this node's own level
  path: GeoPath;
  users: number;
  sessions: number;
  // Distinct descendants rolled up under this node, per deeper level.
  child_counts: Record<ChildField, number>;
  // Kept for the existing state/city summary columns.
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

export function toGeoRow(key: string, path: GeoPath, agg: GeoAgg, totalUsers: number, totalSessions: number): GeoRow {
  const counts = {
    state_province: agg.children.state_province.size,
    city_town: agg.children.city_town.size,
    county_district_lga: agg.children.county_district_lga.size,
    neighborhood_suburb: agg.children.neighborhood_suburb.size,
  };
  return {
    key,
    path,
    users: agg.users.size,
    sessions: agg.sessions.size,
    child_counts: counts,
    regions: counts.state_province,
    cities: counts.city_town,
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

export type GeoLevelField = "country" | ChildField;

export interface GeoHierarchy {
  countries: GeoRow[];
  // Every existing node at each level below country, full-path keyed.
  levels: Record<ChildField, GeoRow[]>;
  // Convenience views over `levels`, grouped by country.
  regionsByCountry: Record<string, GeoRow[]>;
  citiesByCountry: Record<string, CityRow[]>;
}

const SEP = "\u0001";
const LEVEL_ORDER: GeoLevelField[] = ["country", ...CHILD_FIELDS];

interface Touchable {
  path: GeoPath;
  key: string;
  agg: GeoAgg;
}

// Builds every level in one pass over each dataset. A row with no country
// becomes "Unknown" at the country level and is never split further (there is
// nothing trustworthy to split it by).
export function buildGeoHierarchy(rows: AnalyticsEventRow[], adRows: AdEventRow[], totalUsers: number, totalSessions: number): GeoHierarchy {
  const nodes: Record<GeoLevelField, Map<string, Touchable>> = {
    country: new Map(),
    state_province: new Map(),
    city_town: new Map(),
    county_district_lga: new Map(),
    neighborhood_suburb: new Map(),
  };

  const visit = (row: GeoLocationInput, apply: (agg: GeoAgg) => void) => {
    const path = pathOf(row);
    for (const [index, level] of LEVEL_ORDER.entries()) {
      const value = level === "country" ? path.country : path[level];
      if (value === null) continue;
      if (level !== "country" && path.country === UNKNOWN) continue;

      // Node identity = full path down to this level.
      const nodePath: GeoPath = { country: path.country, state_province: null, city_town: null, county_district_lga: null, neighborhood_suburb: null };
      for (const upper of LEVEL_ORDER.slice(1, index + 1) as ChildField[]) nodePath[upper] = path[upper];
      const id = LEVEL_ORDER.slice(0, index + 1)
        .map((l) => (l === "country" ? nodePath.country : (nodePath[l as ChildField] ?? "")))
        .join(SEP);

      let node = nodes[level].get(id);
      if (!node) {
        node = { path: nodePath, key: value, agg: newAgg() };
        nodes[level].set(id, node);
      }
      apply(node.agg);

      // Roll distinct descendants up into this node, keyed by their own
      // full path so same-named places under different parents stay apart.
      for (const child of CHILD_FIELDS) {
        const childIndex = LEVEL_ORDER.indexOf(child);
        if (childIndex <= index || !path[child] || path.country === UNKNOWN) continue;
        node.agg.children[child].add(
          LEVEL_ORDER.slice(1, childIndex + 1)
            .map((l) => path[l as ChildField] ?? "")
            .join(SEP),
        );
      }
    }
  };

  for (const row of rows) {
    visit(row, (agg) => {
      if (row.visitor_id) agg.users.add(row.visitor_id);
      if (row.session_id) agg.sessions.add(row.session_id);
      if (OPEN_EVENTS.has(row.event_name)) agg.opens += weightOf(row);
      if (PDF_JOB_EVENTS.has(row.event_name)) agg.pdf_jobs += weightOf(row);
    });
  }
  for (const row of adRows) {
    visit(row, (agg) => {
      if (row.event_type === "impression") agg.ad_impressions += weightOf(row);
      if (row.event_type === "click") agg.ad_clicks += weightOf(row);
    });
  }

  const finish = (level: GeoLevelField): GeoRow[] =>
    [...nodes[level].values()]
      .map((n) => toGeoRow(n.key, n.path, n.agg, totalUsers, totalSessions))
      .sort((a, b) => b.users - a.users || a.key.localeCompare(b.key));

  const levels = {
    state_province: finish("state_province"),
    city_town: finish("city_town"),
    county_district_lga: finish("county_district_lga"),
    neighborhood_suburb: finish("neighborhood_suburb"),
  };

  const regionsByCountry: Record<string, GeoRow[]> = {};
  for (const row of levels.state_province) (regionsByCountry[row.path.country] ??= []).push(row);
  const citiesByCountry: Record<string, CityRow[]> = {};
  for (const row of levels.city_town) (citiesByCountry[row.path.country] ??= []).push({ ...row, region: row.path.state_province });

  return { countries: finish("country"), levels, regionsByCountry, citiesByCountry };
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
  state_province: string | null;
  city_town: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
  device: string | null;
  visitor_type: VisitorType;
  sessions: number;
  ad_impressions: number;
  ad_clicks: number;
}

function locationKey(date: string, path: GeoPath, device: string | null): string {
  return [
    date,
    path.country,
    path.state_province ?? "",
    path.city_town ?? "",
    path.county_district_lga ?? "",
    path.neighborhood_suburb ?? "",
    device ?? "",
  ].join("\u0001");
}

export function buildLocationRows(
  rows: AnalyticsEventRow[],
  adRows: AdEventRow[],
  returningVisitorIds: ReadonlySet<string>,
): LocationRow[] {
  const sessionRows = new Map<string, { row: LocationRow; sessions: Set<string> }>();

  for (const row of rows) {
    const date = String(row.created_at).slice(0, 10);
    const path = pathOf(row);
    const visitorType: VisitorType = !row.visitor_id ? "unknown" : returningVisitorIds.has(row.visitor_id) ? "returning" : "new";
    const key = `${locationKey(date, path, row.device_type)}\u0001${visitorType}`;
    let entry = sessionRows.get(key);
    if (!entry) {
      entry = {
        row: {
          date,
          country: path.country,
          state_province: path.state_province,
          city_town: path.city_town,
          county_district_lga: path.county_district_lga,
          neighborhood_suburb: path.neighborhood_suburb,
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
    const path = pathOf(row);
    const key = `${locationKey(date, path, row.device_type)}\u0001ads`;
    let entry = adTotals.get(key);
    if (!entry) {
      entry = {
        row: {
          date,
          country: path.country,
          state_province: path.state_province,
          city_town: path.city_town,
          county_district_lga: path.county_district_lga,
          neighborhood_suburb: path.neighborhood_suburb,
          device: row.device_type,
          visitor_type: "ads",
          sessions: 0,
          ad_impressions: 0,
          ad_clicks: 0,
        },
      };
      adTotals.set(key, entry);
    }
    if (row.event_type === "impression") entry.row.ad_impressions += weightOf(row);
    if (row.event_type === "click") entry.row.ad_clicks += weightOf(row);
  }

  const out: LocationRow[] = [];
  for (const { row, sessions } of sessionRows.values()) out.push({ ...row, sessions: sessions.size });
  for (const { row } of adTotals.values()) out.push(row);

  // Ties are broken by the row's own fields so the order never depends on the
  // order the events happened to be read in (raw rows vs SQL-collapsed rows).
  const tie = (r: LocationRow) => [r.date, r.country, r.state_province ?? "", r.city_town ?? "", r.county_district_lga ?? "", r.neighborhood_suburb ?? "", r.device ?? "", r.visitor_type].join("\u0001");
  return out.sort((a, b) => b.sessions - a.sessions || b.ad_impressions - a.ad_impressions || (tie(a) < tie(b) ? -1 : tie(a) > tie(b) ? 1 : 0));
}

// --- Precision coverage ----------------------------------------------------
//
// What the stored data actually contains, per level: how many events carry a
// country, a state/region, a city, a district, a neighbourhood. This is what
// the Geography page shows so "Lagos appears" is never mistaken for "locality
// level data exists". Counts only what is stored; nothing is inferred.

export interface GeoCoverage {
  events: number;
  country: number;
  state_province: number;
  city_town: number;
  county_district_lga: number;
  neighborhood_suburb: number;
  // Stored provider name (e.g. "vercel", "ip2location") -> events. Events
  // recorded before location_source existed are counted under "unrecorded".
  sources: { source: string; events: number }[];
}

export function buildGeoCoverage(rows: (GeoLocationInput & { location_source?: string | null; n?: number })[]): GeoCoverage {
  const out: GeoCoverage = { events: rows.reduce((t, r) => t + weightOf(r), 0), country: 0, state_province: 0, city_town: 0, county_district_lga: 0, neighborhood_suburb: 0, sources: [] };
  const sources = new Map<string, number>();
  for (const row of rows) {
    const w = weightOf(row);
    if (row.country_code && row.country_code !== UNKNOWN) out.country += w;
    if (row.region) out.state_province += w;
    if (row.city) out.city_town += w;
    if (row.county_district_lga) out.county_district_lga += w;
    if (row.neighborhood_suburb) out.neighborhood_suburb += w;
    const source = row.location_source || "unrecorded";
    sources.set(source, (sources.get(source) ?? 0) + w);
  }
  out.sources = [...sources.entries()].sort((a, b) => b[1] - a[1]).map(([source, events]) => ({ source, events }));
  return out;
}
