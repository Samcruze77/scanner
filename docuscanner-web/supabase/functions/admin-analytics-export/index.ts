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
import { matchesFilters, parseFilters, resolveRange } from "../_shared/analyticsFilters.ts"
import { chunk } from "../_shared/paginate.ts"
import {
  AD_SELECT,
  EVENT_SELECT,
  adToRecord,
  eventToRecord,
  parseReportType,
  planFor,
  type AdSourceRow,
  type AdminProfile,
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
      .select("user_id,role,display_name,is_active,created_at,updated_at")
      .eq("user_id", userId)
      .maybeSingle()

    if (adminError || !adminRow?.is_active) return response({ error: "Forbidden" }, 403)
    if (adminRow.role !== "super_admin" && adminRow.role !== "admin") {
      return response({ error: "Forbidden" }, 403)
    }

    const url = new URL(req.url)
    const report = parseReportType(url.searchParams.get("report_type") ?? "full")
    if (!report) return response({ error: "Invalid report_type" }, 400)
    const dataset = url.searchParams.get("dataset") as ExportDataset | null
    if (dataset !== "events" && dataset !== "ads") return response({ error: "Invalid dataset" }, 400)
    const plan = planFor(report)
    if (!plan.datasets.includes(dataset)) return response({ error: "Dataset not part of this report" }, 400)

    const range = resolveRange(url.searchParams)
    if (range.ok === false) return response({ error: range.error }, 400)

    const after = Math.max(Number(url.searchParams.get("after") ?? "0") || 0, 0)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("limit") ?? DEFAULT_PAGE) || DEFAULT_PAGE, 1), MAX_PAGE)
    const filters = parseFilters(url.searchParams)

    const { data: authUser } = await ctx.supabaseAdmin.auth.admin.getUserById(userId)
    const profile: AdminProfile = {
      admin_user_id: adminRow.user_id,
      admin_email: authUser?.user?.email ?? null,
      admin_display_name: adminRow.display_name ?? null,
      admin_role: adminRow.role ?? null,
      admin_is_active: adminRow.is_active ?? null,
      admin_created_at: adminRow.created_at ?? null,
      admin_updated_at: adminRow.updated_at ?? null,
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
      const typeOf = (r: EventSourceRow) => (!r.visitor_id ? "unknown" : returning.has(r.visitor_id) ? "returning" : "new")

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

    // dataset === "ads". visitor_type is not applied: ad_events carry no
    // visitor id (same as the dashboard).
    const { data, error } = await pushDown(
      ctx.supabaseAdmin
        .from("ad_events")
        .select(AD_SELECT)
        .gte("created_at", range.from.toISOString())
        .lt("created_at", range.toExclusive.toISOString())
        .gt("id", after),
    )
      .order("id", { ascending: true })
      .limit(pageSize)
    if (error) return response({ error: "Unable to load ad analytics" }, 500)

    const scanned = (data ?? []) as AdSourceRow[]
    const visible = scanned.filter((r) => matchesFilters(r, filters))

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
