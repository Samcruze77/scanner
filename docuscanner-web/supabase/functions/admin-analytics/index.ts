
import { withSupabase } from "npm:@supabase/server"
import {
  UNKNOWN,
  buildGeoCoverage,
  buildGeoHierarchy,
  buildLocationRows,
  type AnalyticsEventRow as GeoAnalyticsEventRow,
  type AdEventRow as GeoAdEventRow,
} from "../_shared/geoHierarchy.ts"
import { matchesFilters, parseFilters, resolveRange } from "../_shared/analyticsFilters.ts"
import { chunk, fetchAllByKeyset } from "../_shared/paginate.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

const PDF_JOB_EVENTS = new Set(["scan_completed", "conversion_completed"])
const OPEN_EVENTS = new Set(["page_view", "app_open"])

// Superset of geoHierarchy's AnalyticsEventRow -- this route also needs
// user_id/browser/os/referrer/properties for the non-geo overview and
// breakdowns sections, which geoHierarchy has no reason to know about.
interface EventRow extends GeoAnalyticsEventRow {
  id: number
  location_source?: string | null
  browser: string | null
  operating_system: string | null
  referrer: string | null
  properties: Record<string, unknown> | null
}

type AdEventRow = GeoAdEventRow & { id: number }

// Max rows returned in the "all users by location" detail table -- this is
// a per-(date, country, region, city, device, visitor_type) breakdown, which
// can run into the thousands over a 90-day window on real traffic. Sorted by
// sessions/ad_impressions descending first, so truncation drops the least
// active combinations, and `locations_truncated`/`locations_total_rows` in
// the response say so rather than silently hiding data.
const MAX_LOCATION_ROWS = 500

// Visitors are looked up for new/returning in chunks of this size (see
// public.returning_visitor_ids); the result is the source of truth for both
// the visitor_type filter and the location-detail table's new/returning split.
const RETURNING_CHUNK = 500

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "GET") return response({ error: "Method not allowed" }, 405)

    // NOTE: @supabase/server's withSupabase exposes the verified user id as
    // ctx.userClaims.id -- NOT .sub (the raw JWT claim name).
    const userId = ctx.userClaims?.id
    if (!userId) return response({ error: "Unauthorized" }, 401)

    const { data: adminRow, error: adminError } = await ctx.supabaseAdmin
      .from("admin_users")
      .select("role,is_active")
      .eq("user_id", userId)
      .maybeSingle()

    if (adminError || !adminRow?.is_active) {
      return response({ error: "Forbidden" }, 403)
    }

    const role = adminRow.role
    const url = new URL(req.url)
    // Cheap authorization probe for the admin layout: the role only, without
    // reading a single analytics row.
    if (url.searchParams.get("mode") === "role") return response({ role })
    // Geographic + audience filters. All optional; each narrows the SAME
    // dataset used for overview/breakdowns/daily/geo (and, via the shared
    // ../_shared/analyticsFilters.ts, the export), so filtering is consistent
    // across the whole response. Whatever value is passed is matched against
    // whatever the data actually contains -- never a hard-coded place.
    const filters = parseFilters(url.searchParams)
    const range = resolveRange(url.searchParams)
    if (range.ok === false) return response({ error: range.error }, 400)
    const { from, to, toExclusive } = range

    // Paged with keyset pagination: PostgREST caps a single response at its
    // max-rows setting (1000 by default) whatever `.limit()` asks for, which
    // used to silently truncate every aggregate on busy ranges.
    const [eventsResult, adResult] = await Promise.all([
      fetchAllByKeyset<EventRow>((afterId, pageSize) =>
        ctx.supabaseAdmin
          .from("analytics_events")
          .select("id,event_name,visitor_id,session_id,user_id,country_code,region,city,county_district_lga,neighborhood_suburb,location_source,device_type,browser,operating_system,referrer,created_at,properties")
          .gte("created_at", from.toISOString())
          .lt("created_at", toExclusive.toISOString())
          .gt("id", afterId)
          .order("id", { ascending: true })
          .limit(pageSize),
      ),
      fetchAllByKeyset<AdEventRow>((afterId, pageSize) =>
        ctx.supabaseAdmin
          .from("ad_events")
          .select("id,event_type,country_code,region,city,county_district_lga,neighborhood_suburb,device_type,created_at")
          .gte("created_at", from.toISOString())
          .lt("created_at", toExclusive.toISOString())
          .gt("id", afterId)
          .order("id", { ascending: true })
          .limit(pageSize),
      ),
    ])

    if (eventsResult.error) return response({ error: "Unable to load analytics" }, 500)
    if (adResult.error) return response({ error: "Unable to load ad analytics" }, 500)
    const events = eventsResult.rows
    const adEvents = adResult.rows

    let rows = (events ?? []) as EventRow[]
    let adRows = (adEvents ?? []) as AdEventRow[]

    // New vs returning: a visitor is "returning" if they have any event
    // strictly before `from`. Scoped to the visitor ids actually present in
    // this window (not a full-history scan) to stay fast; capped defensively
    // since an extreme number of unique visitors in one window is not a
    // realistic admin query. Computed unconditionally now (not only when
    // ?visitor_type= is passed) because the location-detail table below
    // always breaks sessions down by new/returning.
    const visitorIds = [...new Set(rows.map((r) => r.visitor_id).filter((v): v is string => !!v))]
    const returningIds = new Set<string>()
    for (const ids of chunk(visitorIds, RETURNING_CHUNK)) {
      const { data: priorRows, error: priorError } = await ctx.supabaseAdmin.rpc("returning_visitor_ids", {
        visitor_ids: ids,
        before: from.toISOString(),
      })
      if (priorError) return response({ error: "Unable to load visitor history" }, 500)
      for (const r of (priorRows ?? []) as { visitor_id: string }[]) returningIds.add(r.visitor_id)
    }

    if (filters.visitor_type) {
      rows = rows.filter((r) => {
        const isReturning = !!r.visitor_id && returningIds.has(r.visitor_id)
        return filters.visitor_type === "returning" ? isReturning : !isReturning
      })
    }

    // Location + device filters apply to events and to ad events alike, so
    // ad impressions/clicks reflect the same slice.
    rows = rows.filter((r) => matchesFilters(r, filters))
    adRows = adRows.filter((r) => matchesFilters(r, filters))

    const unique = (values: unknown[]) => new Set(values.filter(Boolean)).size
    const eventCount = (name: string) => rows.filter((r) => r.event_name === name).length

    const topCounts = (values: (string | null)[]) => {
      const counts = new Map<string, number>()
      for (const value of values) {
        if (!value) continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
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
      if (row.event_name === "page_view") entry.views += 1
      if (row.visitor_id) entry.visitors.add(row.visitor_id)
      if (row.event_name === "scan_completed") entry.scans += 1
      if (row.event_name === "document_downloaded") entry.downloads += 1
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
    const totalAdImpressions = adRows.filter((r) => r.event_type === "impression").length
    const totalAdClicks = adRows.filter((r) => r.event_type === "click").length
    const totalPdfJobs = rows.filter((r) => PDF_JOB_EVENTS.has(r.event_name)).length
    const totalOpens = rows.filter((r) => OPEN_EVENTS.has(r.event_name)).length

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

    return response({
      role,
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: {
        country: filters.country,
        state_province: filters.state_province,
        city_town: filters.city_town,
        county_district_lga: filters.county_district_lga,
        neighborhood_suburb: filters.neighborhood_suburb,
        device: filters.device,
        visitor_type: filters.visitor_type,
      },
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
        countries: topCounts(rows.map((r) => r.country_code)),
        regions: topCounts(rows.map((r) => r.region)),
        cities: topCounts(rows.map((r) => r.city)),
        counties: topCounts(rows.map((r) => r.county_district_lga ?? null)),
        neighborhoods: topCounts(rows.map((r) => r.neighborhood_suburb ?? null)),
        devices: topCounts(rows.map((r) => r.device_type)),
        browsers: topCounts(rows.map((r) => r.browser)),
        operating_systems: topCounts(rows.map((r) => r.operating_system)),
        referrers: topCounts(rows.map((r) => r.referrer)),
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
    })
  }),
}
