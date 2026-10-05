
// Super Admin live-visibility API: who's online right now and what's
// happening across the app. Read-only, same admin_users role-gate pattern
// as admin-analytics/admin-users.
//
// Presence definitions (also shown in the Admin UI so the numbers are
// self-explanatory):
//   online          = live_sessions.last_seen within the last 90s
//   recently active = last_seen within the last 15 minutes, but not online
//   (older than 15 minutes is not returned at all -- it's not "live")
//
// The auth.users email/display-name lookup is cached in-memory on the warm
// function instance for 30s (same warm-instance-cache technique already
// used by track-analytics' rate limiter) so a 15-20s admin poll interval
// doesn't force a full user list fetch on every request.

import { withSupabase } from "npm:@supabase/server"
import { createClient } from "npm:@supabase/supabase-js@2"

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

const ONLINE_WINDOW_MS = 90 * 1000
const LIVE_WINDOW_MS = 15 * 60 * 1000
const USER_CACHE_TTL_MS = 30 * 1000

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

let userCache: { at: number; byId: Map<string, { email: string | null }> } | null = null

async function getUserCache(admin: ReturnType<typeof createClient>) {
  if (userCache && Date.now() - userCache.at < USER_CACHE_TTL_MS) return userCache.byId
  const byId = new Map<string, { email: string | null }>()
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) break
    for (const u of data.users) byId.set(u.id, { email: u.email ?? null })
    if (data.users.length < 1000) break
  }
  userCache = { at: Date.now(), byId }
  return byId
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "GET") return response({ error: "Method not allowed" }, 405)

    // @supabase/server exposes the verified user id as ctx.userClaims.id,
    // not .sub (the raw JWT claim name).
    const userId = ctx.userClaims?.id
    if (!userId) return response({ error: "Unauthorized" }, 401)

    const { data: adminRow, error: adminError } = await ctx.supabaseAdmin
      .from("admin_users")
      .select("role,is_active")
      .eq("user_id", userId)
      .maybeSingle()

    if (adminError || !adminRow?.is_active) return response({ error: "Forbidden" }, 403)
    const role = adminRow.role as "super_admin" | "admin" | "analyst"

    const admin = serviceClient()
    const cutoff = new Date(Date.now() - LIVE_WINDOW_MS).toISOString()

    const [{ data: sessions }, { data: profiles }, { data: events }] = await Promise.all([
      admin
        .from("live_sessions")
        .select("session_id,visitor_id,user_id,path,tool,activity,device_type,browser,operating_system,country_code,region,started_at,last_seen")
        .gte("last_seen", cutoff)
        .order("last_seen", { ascending: false }),
      admin.from("user_profiles").select("user_id,display_name"),
      admin
        .from("analytics_events")
        .select("event_name,visitor_id,user_id,path,device_type,country_code,region,properties,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ])

    const needsEmail = (sessions ?? []).some((s) => s.user_id) || (events ?? []).some((e) => e.user_id)
    const userById = needsEmail ? await getUserCache(admin) : new Map<string, { email: string | null }>()
    const nameByUser = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]))

    function label(userIdVal: string | null, visitorId: string | null) {
      if (userIdVal) {
        return nameByUser.get(userIdVal) || userById.get(userIdVal)?.email || "Registered user"
      }
      return visitorId ? `Guest ${visitorId.slice(0, 8)}` : "Guest"
    }

    const now = Date.now()
    const onlineSessions = (sessions ?? []).map((s) => {
      const lastSeenMs = new Date(s.last_seen).getTime()
      return {
        session_id: s.session_id,
        user_id: s.user_id,
        label: label(s.user_id, s.visitor_id),
        path: s.path,
        tool: s.tool,
        activity: s.activity,
        device_type: s.device_type,
        browser: s.browser,
        operating_system: s.operating_system,
        country_code: s.country_code,
        region: s.region,
        started_at: s.started_at,
        last_seen: s.last_seen,
        online: now - lastSeenMs <= ONLINE_WINDOW_MS,
      }
    })

    const activity = (events ?? []).map((e) => ({
      event_name: e.event_name,
      label: label(e.user_id, e.visitor_id),
      path: e.path,
      device_type: e.device_type,
      country_code: e.country_code,
      region: e.region,
      properties: e.properties,
      created_at: e.created_at,
    }))

    return response({
      role,
      definitions: {
        online_window_seconds: ONLINE_WINDOW_MS / 1000,
        recently_active_window_seconds: LIVE_WINDOW_MS / 1000,
      },
      online_count: onlineSessions.filter((s) => s.online).length,
      sessions: onlineSessions,
      activity,
    })
  }),
}
