// Everything the admin dashboard / geography pages show, computed from already
// filtered event rows. Pure (no I/O) so it is tested directly against the raw,
// uncollapsed rows and against the SQL-collapsed rows (tests/analytics/
// admin-summary.mjs): rows may carry `n` (how many identical events they stand for).

import {
  UNKNOWN,
  buildGeoCoverage,
  buildGeoHierarchy,
  buildLocationRows,
  weightOf,
  type AdEventRow,
  type AnalyticsEventRow,
} from "./geoHierarchy.ts";

// Max rows returned in the "all users by location" detail table. Sorted by
// sessions/ad_impressions descending first, so truncation drops the least active
// combinations, and `locations_truncated`/`locations_total_rows` say so.
export const MAX_LOCATION_ROWS = 500;

const PDF_JOB_EVENTS = new Set(["scan_completed", "conversion_completed"]);
const OPEN_EVENTS = new Set(["page_view", "app_open"]);

export interface SummaryEventRow extends AnalyticsEventRow {
  browser: string | null;
  operating_system: string | null;
  referrer: string | null;
  location_source?: string | null;
}

export function buildAdminSummary(rows: SummaryEventRow[], adRows: AdEventRow[], returningIds: ReadonlySet<string>) {
  const unique = (values: unknown[]) => new Set(values.filter(Boolean)).size
  const eventCount = (name: string) => rows.reduce((t, r) => t + (r.event_name === name ? weightOf(r) : 0), 0)

  const topCounts = (values: (string | null)[], weights: number[]) => {
    const counts = new Map<string, number>()
    for (const [i, value] of values.entries()) {
      if (!value) continue
      const weight = weights[i]
      counts.set(value, (counts.get(value) ?? 0) + weight)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, 20)
      .map(([key, count]) => ({ key, count }))
  }

  const dailyMap = new Map<string, { views: number; visitors: Set<string>; scans: number; downloads: number }>()
  for (const row of rows) {
    const date = String(row.created_at).slice(0, 10)
    let entry = dailyMap.get(date)
    if (!entry) {
      entry = { views: 0, visitors: new Set<string>(), scans: 0, downloads: 0 }
      dailyMap.set(date, entry)
    }
    if (row.event_name === "page_view") entry.views += weightOf(row)
    if (row.visitor_id) entry.visitors.add(row.visitor_id)
    if (row.event_name === "scan_completed") entry.scans += weightOf(row)
    if (row.event_name === "document_downloaded") entry.downloads += weightOf(row)
  }

  const daily = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, entry]) => ({
      date,
      page_views: entry.views,
      unique_visitors: entry.visitors.size,
      scans: entry.scans,
      downloads: entry.downloads,
    }))

  const sessions = unique(rows.map((r) => r.session_id))
  const registeredUsers = unique(rows.filter((r) => r.user_id).map((r) => r.user_id))
  const visitors = unique(rows.map((r) => r.visitor_id))
  const totalAdImpressions = adRows.reduce((t, r) => t + (r.event_type === "impression" ? weightOf(r) : 0), 0)
  const totalAdClicks = adRows.reduce((t, r) => t + (r.event_type === "click" ? weightOf(r) : 0), 0)
  const totalPdfJobs = rows.reduce((t, r) => t + (PDF_JOB_EVENTS.has(r.event_name) ? weightOf(r) : 0), 0)
  const totalOpens = rows.reduce((t, r) => t + (OPEN_EVENTS.has(r.event_name) ? weightOf(r) : 0), 0)

  // --- Geography: Country -> Region -> City, full dataset (sorted by
  // users desc), never a hard-coded/truncated list -- see
  // ../_shared/geoHierarchy.ts. Works for any country worldwide: keys come
  // entirely from whatever country_code/region/city values exist in the
  // data.
  const totalUsers = visitors
  const totalSessions = sessions
  const { countries, levels, regionsByCountry, citiesByCountry } = buildGeoHierarchy(rows, adRows, totalUsers, totalSessions)

  const countriesRepresented = countries.filter((c) => c.key !== UNKNOWN).length
  // Distinct places actually present at each level (full-path keyed, so
  // same-named places under different parents are counted separately).
  const citiesRepresented = levels.city_town.length
  const countiesRepresented = levels.county_district_lga.length
  const neighborhoodsRepresented = levels.neighborhood_suburb.length

  // --- "All users by location": one row per (date, country, region,
  // city, device, new/returning), capped and sorted by activity so the
  // admin can inspect exactly where traffic is coming from without a
  // second, unrelated analytics table -- see buildLocationRows for why ad
  // metrics land on a separate synthetic row instead of being duplicated
  // across visitor-type rows.
  const allLocationRows = buildLocationRows(rows, adRows, returningIds)
  // `region`/`city` are transitional aliases of state_province/city_town for
  // admin pages deployed before the canonical names; remove once rolled out.
  const locations = allLocationRows.slice(0, MAX_LOCATION_ROWS).map((r) => ({ ...r, region: r.state_province, city: r.city_town }))

  return {
    overview: {
      page_views: eventCount("page_view"),
      unique_visitors: visitors,
      sessions,
      registered_users: registeredUsers,
      scans_started: eventCount("scan_started"),
      scans_completed: eventCount("scan_completed"),
      conversions_completed: eventCount("conversion_completed"),
      downloads: eventCount("document_downloaded"),
      signups: eventCount("signup_completed"),
      opens: totalOpens,
      pdf_jobs: totalPdfJobs,
      ad_impressions: totalAdImpressions,
      ad_clicks: totalAdClicks,
      ad_ctr: totalAdImpressions > 0 ? Number(((totalAdClicks / totalAdImpressions) * 100).toFixed(2)) : null,
      countries: countriesRepresented,
      cities: citiesRepresented,
      counties: countiesRepresented,
      neighborhoods: neighborhoodsRepresented,
    },
    breakdowns: {
      countries: topCounts(rows.map((r) => r.country_code), rows.map(weightOf)),
      regions: topCounts(rows.map((r) => r.region), rows.map(weightOf)),
      cities: topCounts(rows.map((r) => r.city), rows.map(weightOf)),
      counties: topCounts(rows.map((r) => r.county_district_lga ?? null), rows.map(weightOf)),
      neighborhoods: topCounts(rows.map((r) => r.neighborhood_suburb ?? null), rows.map(weightOf)),
      devices: topCounts(rows.map((r) => r.device_type), rows.map(weightOf)),
      browsers: topCounts(rows.map((r) => r.browser), rows.map(weightOf)),
      operating_systems: topCounts(rows.map((r) => r.operating_system), rows.map(weightOf)),
      referrers: topCounts(rows.map((r) => r.referrer), rows.map(weightOf)),
    },
    geo: {
      countries,
      // Every existing node at each level below country, keyed by full
      // path (see GeoRow.path). Drill-down = filter by path prefix.
      levels,
      regions_by_country: regionsByCountry,
      cities_by_country: citiesByCountry,
    },
    geo_coverage: buildGeoCoverage(rows),
    locations,
    locations_total_rows: allLocationRows.length,
    locations_truncated: allLocationRows.length > MAX_LOCATION_ROWS,
    daily,
  };
}
