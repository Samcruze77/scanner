
import { withSupabase } from "npm:@supabase/server"

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

const UNKNOWN = "Unknown"
const PDF_JOB_EVENTS = new Set(["scan_completed", "conversion_completed"])
const OPEN_EVENTS = new Set(["page_view", "app_open"])

interface EventRow {
  event_name: string
  visitor_id: string | null
  session_id: string | null
  user_id: string | null
  country_code: string | null
  region: string | null
  city: string | null
  device_type: string | null
  browser: string | null
  operating_system: string | null
  referrer: string | null
  created_at: string
  properties: Record<string, unknown> | null
}

interface AdEventRow {
  event_type: "impression" | "click"
  country_code: string | null
  region: string | null
  city: string | null
  created_at: string
}

interface GeoAgg {
  users: Set<string>
  sessions: Set<string>
  opens: number
  pdf_jobs: number
  ad_impressions: number
  ad_clicks: number
}

function newAgg(): GeoAgg {
  return { users: new Set(), sessions: new Set(), opens: 0, pdf_jobs: 0, ad_impressions: 0, ad_clicks: 0 }
}

function applyEventToAgg(agg: GeoAgg, row: EventRow) {
  if (row.visitor_id) agg.users.add(row.visitor_id)
  if (row.session_id) agg.sessions.add(row.session_id)
  if (OPEN_EVENTS.has(row.event_name)) agg.opens += 1
  if (PDF_JOB_EVENTS.has(row.event_name)) agg.pdf_jobs += 1
}

function applyAdEventToAgg(agg: GeoAgg, row: AdEventRow) {
  if (row.event_type === "impression") agg.ad_impressions += 1
  if (row.event_type === "click") agg.ad_clicks += 1
}

interface GeoRow {
  key: string
  users: number
  sessions: number
  opens: number
  pdf_jobs: number
  ad_impressions: number
  ad_clicks: number
  ctr: number | null
  pct_users: number | null
  pct_sessions: number | null
}

function toGeoRow(key: string, agg: GeoAgg, totalUsers: number, totalSessions: number): GeoRow {
  return {
    key,
    users: agg.users.size,
    sessions: agg.sessions.size,
    opens: agg.opens,
    pdf_jobs: agg.pdf_jobs,
    ad_impressions: agg.ad_impressions,
    ad_clicks: agg.ad_clicks,
    ctr: agg.ad_impressions > 0 ? Number(((agg.ad_clicks / agg.ad_impressions) * 100).toFixed(2)) : null,
    pct_users: totalUsers > 0 ? Number(((agg.users.size / totalUsers) * 100).toFixed(2)) : null,
    pct_sessions: totalSessions > 0 ? Number(((agg.sessions.size / totalSessions) * 100).toFixed(2)) : null,
  }
}

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
    const toParam = url.searchParams.get("to")
    const fromParam = url.searchParams.get("from")
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "30"), 1), 365)

    // Geographic + audience filters. All optional; each narrows the SAME
    // dataset used for overview/breakdowns/daily/geo, so filtering is
    // consistent across the whole response rather than only affecting one
    // section. Country/region/city are never hard-coded -- whatever value
    // is passed is matched against whatever the data actually contains.
    const filterCountry = url.searchParams.get("country")?.toUpperCase() || null
    const filterRegion = url.searchParams.get("region") || null
    const filterCity = url.searchParams.get("city") || null
    const filterDevice = url.searchParams.get("device") || null
    const filterVisitorType = url.searchParams.get("visitor_type") // "new" | "returning"

    const to = toParam ? new Date(toParam) : new Date()
    const from = fromParam
      ? new Date(fromParam)
      : new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return response({ error: "Invalid date range" }, 400)
    }

    const [{ data: events, error }, { data: adEvents, error: adError }] = await Promise.all([
      ctx.supabaseAdmin
        .from("analytics_events")
        .select("event_name,visitor_id,session_id,user_id,country_code,region,city,device_type,browser,operating_system,referrer,created_at,properties")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at", { ascending: false })
        .limit(100000),
      ctx.supabaseAdmin
        .from("ad_events")
        .select("event_type,country_code,region,city,created_at")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .limit(100000),
    ])

    if (error) return response({ error: "Unable to load analytics" }, 500)
    if (adError) return response({ error: "Unable to load ad analytics" }, 500)

    let rows = (events ?? []) as EventRow[]
    let adRows = (adEvents ?? []) as AdEventRow[]

    // New vs returning: a visitor is "returning" if they have any event
    // strictly before `from`. Scoped to the visitor ids actually present in
    // this window (not a full-history scan) to stay fast; capped defensively
    // since an extreme number of unique visitors in one window is not a
    // realistic admin query.
    if (filterVisitorType === "new" || filterVisitorType === "returning") {
      const visitorIds = [...new Set(rows.map((r) => r.visitor_id).filter((v): v is string => !!v))].slice(0, 5000)
      let returningIds = new Set<string>()
      if (visitorIds.length > 0) {
        const { data: priorRows } = await ctx.supabaseAdmin
          .from("analytics_events")
          .select("visitor_id")
          .lt("created_at", from.toISOString())
          .in("visitor_id", visitorIds)
          .limit(100000)
        returningIds = new Set((priorRows ?? []).map((r: { visitor_id: string | null }) => r.visitor_id).filter((v): v is string => !!v))
      }
      rows = rows.filter((r) => {
        const isReturning = !!r.visitor_id && returningIds.has(r.visitor_id)
        return filterVisitorType === "returning" ? isReturning : !isReturning
      })
    }

    if (filterCountry) rows = rows.filter((r) => (r.country_code ?? UNKNOWN) === filterCountry)
    if (filterRegion) rows = rows.filter((r) => r.region === filterRegion)
    if (filterCity) rows = rows.filter((r) => r.city === filterCity)
    if (filterDevice) rows = rows.filter((r) => r.device_type === filterDevice)

    // Ad events use the same geo filters where applicable (country/region/city)
    // so "ad impressions/clicks" in the summary reflect the same slice.
    if (filterCountry) adRows = adRows.filter((r) => (r.country_code ?? UNKNOWN) === filterCountry)
    if (filterRegion) adRows = adRows.filter((r) => r.region === filterRegion)
    if (filterCity) adRows = adRows.filter((r) => r.city === filterCity)

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

    // --- Geography: countries (full dataset, sorted by users desc),
    // regions/cities grouped per country so the admin UI can drill down
    // without another round trip. Works for any country worldwide -- keys
    // come entirely from whatever country_code/region/city values exist in
    // the data, nothing is hard-coded.
    const countryAgg = new Map<string, GeoAgg>()
    const regionAgg = new Map<string, Map<string, GeoAgg>>() // country_code -> region -> agg
    const cityAgg = new Map<string, Map<string, { region: string | null; agg: GeoAgg }>>() // country_code -> city -> agg

    for (const row of rows) {
      const country = row.country_code ?? UNKNOWN
      if (!countryAgg.has(country)) countryAgg.set(country, newAgg())
      applyEventToAgg(countryAgg.get(country)!, row)

      if (row.region) {
        if (!regionAgg.has(country)) regionAgg.set(country, new Map())
        const byRegion = regionAgg.get(country)!
        if (!byRegion.has(row.region)) byRegion.set(row.region, newAgg())
        applyEventToAgg(byRegion.get(row.region)!, row)
      }

      if (row.city) {
        if (!cityAgg.has(country)) cityAgg.set(country, new Map())
        const byCity = cityAgg.get(country)!
        if (!byCity.has(row.city)) byCity.set(row.city, { region: row.region, agg: newAgg() })
        applyEventToAgg(byCity.get(row.city)!.agg, row)
      }
    }

    for (const row of adRows) {
      const country = row.country_code ?? UNKNOWN
      if (!countryAgg.has(country)) countryAgg.set(country, newAgg())
      applyAdEventToAgg(countryAgg.get(country)!, row)

      if (row.region) {
        if (!regionAgg.has(country)) regionAgg.set(country, new Map())
        const byRegion = regionAgg.get(country)!
        if (!byRegion.has(row.region)) byRegion.set(row.region, newAgg())
        applyAdEventToAgg(byRegion.get(row.region)!, row)
      }

      if (row.city) {
        if (!cityAgg.has(country)) cityAgg.set(country, new Map())
        const byCity = cityAgg.get(country)!
        if (!byCity.has(row.city)) byCity.set(row.city, { region: row.region, agg: newAgg() })
        applyAdEventToAgg(byCity.get(row.city)!.agg, row)
      }
    }

    const totalUsers = visitors
    const totalSessions = sessions

    const countries = [...countryAgg.entries()]
      .map(([key, agg]) => toGeoRow(key, agg, totalUsers, totalSessions))
      .sort((a, b) => b.users - a.users)

    const regionsByCountry: Record<string, GeoRow[]> = {}
    for (const [country, byRegion] of regionAgg) {
      regionsByCountry[country] = [...byRegion.entries()]
        .map(([key, agg]) => toGeoRow(key, agg, totalUsers, totalSessions))
        .sort((a, b) => b.users - a.users)
    }

    const citiesByCountry: Record<string, (GeoRow & { region: string | null })[]> = {}
    for (const [country, byCity] of cityAgg) {
      citiesByCountry[country] = [...byCity.entries()]
        .map(([key, { region, agg }]) => ({ ...toGeoRow(key, agg, totalUsers, totalSessions), region }))
        .sort((a, b) => b.users - a.users)
    }

    return response({
      role,
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: {
        country: filterCountry,
        region: filterRegion,
        city: filterCity,
        device: filterDevice,
        visitor_type: filterVisitorType ?? null,
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
      },
      breakdowns: {
        countries: topCounts(rows.map((r) => r.country_code)),
        regions: topCounts(rows.map((r) => r.region)),
        cities: topCounts(rows.map((r) => r.city)),
        devices: topCounts(rows.map((r) => r.device_type)),
        browsers: topCounts(rows.map((r) => r.browser)),
        operating_systems: topCounts(rows.map((r) => r.operating_system)),
        referrers: topCounts(rows.map((r) => r.referrer)),
      },
      geo: {
        countries,
        regions_by_country: regionsByCountry,
        cities_by_country: citiesByCountry,
      },
      daily,
    })
  }),
}
