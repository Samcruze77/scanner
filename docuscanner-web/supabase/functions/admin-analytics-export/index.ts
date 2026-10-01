// Paged, filtered export source for the admin analytics download. The Next.js
// route /api/admin/analytics-export calls this once per page with the caller's
// own access token and streams the pages into a CSV/XLSX/JSON file, so an
// export is bounded by the database, not by a UI page size or one request.
//
// Authorization is enforced here, server-side, exactly like admin-analytics:
// the caller must be an active admin_users row with role super_admin/admin
// (analyst is read-only). Uses the same filter parsing as the dashboard
// (../_shared/analyticsFilters.ts) so the file matches what is on screen.
//
// Never returns ip_hash, service credentials or any other infrastructure
// value: only the columns listed in ../_shared/exportRows.ts.

import { withSupabase } from "npm:@supabase/server"
import { hasAdFilters, matchesAdFilters, matchesFilters, parseFilters, resolveRange } from "../_shared/analyticsFilters.ts"
import { chunk } from "../_shared/paginate.ts"
import { buildAdminProfile } from "../_shared/adminProfile.ts"
import {
  AD_SELECT,
  EVENT_SELECT,
  adToRecord,
  eventToRecord,
  parseReportType,
  planFor,
  type AdSourceRow,
  type EventSourceRow,
  type ExportDataset,
} from "../_shared/exportRows.ts"

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

const MAX_PAGE = 2000
// With `page=large` and the SQL page function installed (migration
// 20260930150000) one call returns up to this many rows: the function returns a
// single jsonb value, so PostgREST's 1000-row max-rows does not apply. Callers
// that do not send `page=large` (older deployments of the route) keep the
// previous behaviour exactly.
const MAX_LARGE_PAGE = 5000
const DEFAULT_PAGE = 1000
const RETURNING_CHUNK = 500

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "GET") return response({ error: "Method not allowed" }, 405)

    const userId = ctx.userClaims?.id
    if (!userId) return response({ error: "Unauthorized" }, 401)

    const { data: adminRow, error: adminError } = await ctx.supabaseAdmin
      .from("admin_users")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()

    if (adminError || !adminRow?.is_active) return response({ error: "Forbidden" }, 403)
    if (adminRow.role !== "super_admin" && adminRow.role !== "admin") {
      return response({ error: "Forbidden" }, 403)
    }

    const url = new URL(req.url)

    // Option lists for the export page's campaign / creative / slot filters.
    if (url.searchParams.get("mode") === "options") {
      const [{ data: campaigns }, { data: creatives }] = await Promise.all([
        ctx.supabaseAdmin.from("ad_campaigns").select("id,name,status").order("name", { ascending: true }),
        ctx.supabaseAdmin.from("ad_creatives").select("id,campaign_id,slot_code,title").order("created_at", { ascending: true }),
      ])
      const slots = [...new Set((creatives ?? []).map((c: { slot_code: string }) => c.slot_code).filter(Boolean))].sort()
      return response({ campaigns: campaigns ?? [], creatives: creatives ?? [], slots })
    }

    const report = parseReportType(url.searchParams.get("report_type") ?? "full")
    if (!report) return response({ error: "Invalid report_type" }, 400)
    const dataset = url.searchParams.get("dataset") as ExportDataset | null
    if (dataset !== "events" && dataset !== "ads") return response({ error: "Invalid dataset" }, 400)
    const filters = parseFilters(url.searchParams)
    const plan = planFor(report, hasAdFilters(filters))
    if (!plan.datasets.includes(dataset)) return response({ error: "Dataset not part of this report" }, 400)

    const range = resolveRange(url.searchParams)
    if (range.ok === false) return response({ error: range.error }, 400)

    const after = Math.max(Number(url.searchParams.get("after") ?? "0") || 0, 0)
    const large = url.searchParams.get("page") === "large"
    const requested = Math.max(Number(url.searchParams.get("limit") ?? DEFAULT_PAGE) || DEFAULT_PAGE, 1)
    // `page=large` asks for the biggest page; `limit` is then ignored. The route always
    // also sends limit=1000, which an older deployed function honours as before.
    let pageSize = large ? MAX_LARGE_PAGE : Math.min(requested, MAX_PAGE)

    // Derived from the real rows (every non-secret column) -- see
    // ../_shared/adminProfile.ts for what is excluded and why. A `page=large`
    // caller only needs it once (first page of each dataset), so later pages skip
    // two database round trips.
    let profile: ReturnType<typeof buildAdminProfile> | null = null
    if (!large || after === 0) {
      const [{ data: authUser }, { data: userProfileRow }] = await Promise.all([
        ctx.supabaseAdmin.auth.admin.getUserById(userId),
        ctx.supabaseAdmin.from("user_profiles").select("*").eq("user_id", userId).maybeSingle(),
      ])
      profile = buildAdminProfile({
        adminRow,
        userProfileRow,
        authUser: (authUser?.user ?? null) as Record<string, unknown> | null,
      })
    }

    // Plain-equality filters are also pushed into SQL so a narrow selection
    // over a large table doesn't scan every row; the same predicate is
    // re-applied in memory below (it alone handles "Unknown").
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pushDown = (q: any) => {
      if (filters.country && filters.country !== "UNKNOWN") q = q.eq("country_code", filters.country)
      if (filters.state_province) q = q.eq("region", filters.state_province)
      if (filters.city_town) q = q.eq("city", filters.city_town)
      if (filters.county_district_lga) q = q.eq("county_district_lga", filters.county_district_lga)
      if (filters.neighborhood_suburb) q = q.eq("neighborhood_suburb", filters.neighborhood_suburb)
      if (filters.device) q = q.eq("device_type", filters.device)
      return q
    }
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pushDownAds = (q: any) => {
      if (filters.campaign_id) q = q.eq("campaign_id", filters.campaign_id)
      if (filters.creative_id) q = q.eq("creative_id", filters.creative_id)
      if (filters.slot_code) q = q.eq("slot_code", filters.slot_code)
      return q
    }

    // Exports of analytics/admin data are audited (first page of each dataset
    // only, so a paged download logs once). Best effort: never blocks a read.
    if (after === 0) {
      await ctx.supabaseAdmin.from("admin_audit_logs").insert({
        admin_user_id: userId,
        action: "analytics_export",
        target_type: "analytics",
        metadata: {
          report_type: report,
          dataset,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          filters,
        },
      })
    }

    if (dataset === "events") {
      const typeOfFactory = (returning: Set<string>) => (r: EventSourceRow) => (!r.visitor_id ? "unknown" : returning.has(r.visitor_id) ? "returning" : "new")

      // One call: the page, filtered in SQL, with new-vs-returning resolved.
      const rpc = await ctx.supabaseAdmin.rpc("admin_export_events_page", {
        p_from: range.from.toISOString(),
        p_to: range.toExclusive.toISOString(),
        p_after: after,
        p_limit: pageSize,
        p_event_names: plan.eventNames ?? null,
        p_country: filters.country && filters.country !== "UNKNOWN" ? filters.country : null,
        p_region: filters.state_province,
        p_city: filters.city_town,
        p_district: filters.county_district_lga,
        p_neighborhood: filters.neighborhood_suburb,
        p_device: filters.device,
      })
      if (!rpc.error && rpc.data && Array.isArray(rpc.data.rows)) {
        const scanned = rpc.data.rows as (EventSourceRow & { is_returning?: boolean })[]
        const returning = new Set(scanned.filter((r) => r.is_returning && r.visitor_id).map((r) => r.visitor_id as string))
        const typeOf = typeOfFactory(returning)
        const rows = scanned
          .filter((r) => matchesFilters(r, filters))
          .filter((r) => !filters.visitor_type || typeOf(r) === filters.visitor_type)
          .map((r) => eventToRecord(r, typeOf(r)))
        const effective = Math.min(pageSize, MAX_LARGE_PAGE)
        return response({
          profile,
          dataset,
          rows,
          next_after: scanned.length >= effective ? scanned[scanned.length - 1].id : null,
          scanned: scanned.length,
        })
      }

      // SQL function not installed (migration pending): previous paged read.
      // PostgREST returns at most 1000 rows per request whatever was asked, so
      // never treat a larger page size as "full".
      pageSize = Math.min(pageSize, 1000)
      let query = ctx.supabaseAdmin
        .from("analytics_events")
        .select(EVENT_SELECT)
        .gte("created_at", range.from.toISOString())
        .lt("created_at", range.toExclusive.toISOString())
        .gt("id", after)
      if (plan.eventNames) query = query.in("event_name", plan.eventNames)
      const { data, error } = await pushDown(query).order("id", { ascending: true }).limit(pageSize)
      if (error) return response({ error: "Unable to load analytics" }, 500)

      const scanned = (data ?? []) as EventSourceRow[]
      const visible = scanned.filter((r) => matchesFilters(r, filters))

      // New vs returning: any event strictly before `from` (same definition
      // as the dashboard).
      const visitorIds = [...new Set(visible.map((r) => r.visitor_id).filter((v): v is string => !!v))]
      const returning = new Set<string>()
      for (const ids of chunk(visitorIds, RETURNING_CHUNK)) {
        const { data: prior, error: priorError } = await ctx.supabaseAdmin.rpc("returning_visitor_ids", {
          visitor_ids: ids,
          before: range.from.toISOString(),
        })
        if (priorError) return response({ error: "Unable to resolve visitor history" }, 500)
        for (const r of (prior ?? []) as { visitor_id: string }[]) returning.add(r.visitor_id)
      }
      const typeOf = typeOfFactory(returning)

      const rows = visible
        .filter((r) => !filters.visitor_type || typeOf(r) === filters.visitor_type)
        .map((r) => eventToRecord(r, typeOf(r)))

      return response({
        profile,
        dataset,
        rows,
        next_after: scanned.length === pageSize ? scanned[scanned.length - 1].id : null,
        scanned: scanned.length,
      })
    }

    // dataset === "ads" (read through PostgREST, which returns at most 1000 rows per request).
    pageSize = Math.min(pageSize, 1000)
    // dataset === "ads". visitor_type is not applied: ad_events carry no
    // visitor id (same as the dashboard).
    const { data, error } = await pushDownAds(pushDown(
      ctx.supabaseAdmin
        .from("ad_events")
        .select(AD_SELECT)
        .gte("created_at", range.from.toISOString())
        .lt("created_at", range.toExclusive.toISOString())
        .gt("id", after),
    ))
      .order("id", { ascending: true })
      .limit(pageSize)
    if (error) return response({ error: "Unable to load ad analytics" }, 500)

    const scanned = (data ?? []) as AdSourceRow[]
    const visible = scanned.filter((r) => matchesFilters(r, filters) && matchesAdFilters(r, filters))

    // Campaign names come from a single id -> name lookup (never a join), so
    // an ad event can't be duplicated by its campaign.
    const campaignIds = [...new Set(visible.map((r) => r.campaign_id).filter((v): v is string => !!v))]
    const names = new Map<string, string>()
    if (campaignIds.length > 0) {
      const { data: campaigns } = await ctx.supabaseAdmin.from("ad_campaigns").select("id,name").in("id", campaignIds)
      for (const c of (campaigns ?? []) as { id: string; name: string }[]) names.set(c.id, c.name)
    }

    return response({
      profile,
      dataset,
      rows: visible.map((r) => adToRecord(r, names)),
      next_after: scanned.length === pageSize ? scanned[scanned.length - 1].id : null,
      scanned: scanned.length,
    })
  }),
}
