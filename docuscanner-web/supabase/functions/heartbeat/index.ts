// Upserts one live_sessions row per session_id. Called ONLY by this app's
// own /api/analytics/heartbeat Route Handler -- see
// supabase/functions/track-analytics/index.ts for why auth: 'secret' plus a
// caller-supplied geo/user_id is the trusted model here now.

import { withSupabase } from "npm:@supabase/server"
import {
  normalizeString,
  extractTrustedGeo,
  deviceFromUserAgent,
  browserFromUserAgent,
  osFromUserAgent,
  corsHeaders,
  json,
} from "../_shared/geo.ts"

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: "Invalid JSON" }, 400)
    }

    const sessionId = normalizeString(body.session_id, 128)
    const visitorId = normalizeString(body.visitor_id, 128)
    const path = normalizeString(body.path, 300)
    const tool = normalizeString(body.tool, 80)
    const activity = normalizeString(body.activity, 80)
    if (!sessionId || !visitorId) return json({ error: "session_id and visitor_id are required" }, 400)

    const geo = extractTrustedGeo(req, body)
    const userAgent = req.headers.get("user-agent") ?? ""
    const userId = typeof body.user_id === "string" ? body.user_id : null

    const fields = {
      visitor_id: visitorId,
      user_id: userId,
      path,
      tool,
      activity,
      device_type: deviceFromUserAgent(userAgent),
      browser: browserFromUserAgent(userAgent),
      operating_system: osFromUserAgent(userAgent),
      country_code: geo.countryCode,
      region: geo.region,
      city: geo.city,
      county_district_lga: geo.countyDistrictLga,
      neighborhood_suburb: geo.neighborhoodSuburb,
      postal_code: geo.postalCode,
      location_source: geo.source === "unknown" ? null : geo.source,
      last_seen: new Date().toISOString(),
    }

    const { data: updated, error: updateError } = await ctx.supabaseAdmin
      .from("live_sessions")
      .update(fields)
      .eq("session_id", sessionId)
      .select("session_id")

    if (updateError) return json({ error: "Unable to record heartbeat" }, 500)

    if (!updated || updated.length === 0) {
      const { error: insertError } = await ctx.supabaseAdmin.from("live_sessions").insert({ session_id: sessionId, ...fields })
      if (insertError) return json({ error: "Unable to record heartbeat" }, 500)
    }

    return json({ ok: true }, 202)
  }),
}
