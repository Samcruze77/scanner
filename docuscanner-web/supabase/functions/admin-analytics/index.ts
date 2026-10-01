
import { withSupabase } from "npm:@supabase/server"
import { type AnalyticsEventRow as GeoAnalyticsEventRow, type AdEventRow as GeoAdEventRow } from "../_shared/geoHierarchy.ts"
import { buildAdminSummary } from "../_shared/adminSummary.ts"
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


// Visitors are looked up for new/returning in chunks of this size (see
// public.returning_visitor_ids); the result is the source of truth for both
// the visitor_type filter and the location-detail table's new/returning split.
const RETURNING_CHUNK = 500

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyCtx = { supabaseAdmin: any }

// Previous implementation: keyset-paged reads through PostgREST (1000 rows per
// round trip) plus one RPC per 500 visitors. Kept only as the fallback above.
async function loadRowsLegacy(ctx: LegacyCtx, from: Date, toExclusive: Date, returningIds: Set<string>) {
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
  if (eventsResult.error) return { error: "Unable to load analytics", rows: [] as EventRow[], adRows: [] as AdEventRow[] }
  if (adResult.error) return { error: "Unable to load ad analytics", rows: [] as EventRow[], adRows: [] as AdEventRow[] }
  const visitorIds = [...new Set(eventsResult.rows.map((r) => r.visitor_id).filter((v): v is string => !!v))]
  for (const ids of chunk(visitorIds, RETURNING_CHUNK)) {
    const { data: priorRows, error: priorError } = await ctx.supabaseAdmin.rpc("returning_visitor_ids", {
      visitor_ids: ids,
      before: from.toISOString(),
    })
    if (priorError) return { error: "Unable to load visitor history", rows: [] as EventRow[], adRows: [] as AdEventRow[] }
    for (const r of (priorRows ?? []) as { visitor_id: string }[]) returningIds.add(r.visitor_id)
  }
  return { error: null, rows: eventsResult.rows, adRows: adResult.rows }
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

    // One database call does the collapsing (public.admin_analytics_event_groups /
    // admin_analytics_ad_groups): rows come back grouped with a count `n` and a
    // `returning` flag. If those functions are not installed yet (migration not
    // applied), fall back to the previous paged read so a deploy order mix-up
    // can never break the dashboard.
    let rows: EventRow[]
    let adRows: AdEventRow[]
    const returningIds = new Set<string>()
    const [groups, adGroups] = await Promise.all([
      ctx.supabaseAdmin.rpc("admin_analytics_event_groups", { p_from: from.toISOString(), p_to: toExclusive.toISOString() }),
      ctx.supabaseAdmin.rpc("admin_analytics_ad_groups", { p_from: from.toISOString(), p_to: toExclusive.toISOString() }),
    ])
    if (!groups.error && !adGroups.error && Array.isArray(groups.data) && Array.isArray(adGroups.data)) {
      rows = (groups.data as (EventRow & { returning?: boolean })[]).map((r) => {
        if (r.returning && r.visitor_id) returningIds.add(r.visitor_id)
        return r
      })
      adRows = adGroups.data as AdEventRow[]
    } else {
      const legacy = await loadRowsLegacy(ctx, from, toExclusive, returningIds)
      if (legacy.error) return response({ error: legacy.error }, 500)
      rows = legacy.rows
      adRows = legacy.adRows
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

    const summary = buildAdminSummary(rows, adRows, returningIds)

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
      ...summary,
    })
  }),
}
