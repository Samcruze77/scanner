// Records one analytics_events row. Called ONLY by this app's own
// /api/analytics/track Route Handler (see docuscanner-web/utils/analytics/
// proxy.server.ts) -- auth: 'secret' rejects any request that doesn't carry
// the project's secret key, which is what makes the caller-supplied
// user_id/geo trustworthy. A browser can no longer call this directly or
// forge its own country/region/city, unlike the previous direct-to-Supabase
// version of this function.

import { withSupabase } from "npm:@supabase/server"
import {
  normalizeString,
  extractTrustedGeo,
  deviceFromUserAgent,
  browserFromUserAgent,
  osFromUserAgent,
  hmacIp,
  corsHeaders,
  json,
} from "../_shared/geo.ts"

const ALLOWED_EVENTS = new Set([
  "page_view",
  "app_open",
  "signup_started",
  "signup_completed",
  "login",
  "logout",
  "scan_started",
  "scan_completed",
  "document_uploaded",
  "document_created",
  "conversion_started",
  "conversion_completed",
  "document_downloaded",
  "feature_used",
  "error",
])

const RATE_WINDOW_MS = 60_000
const MAX_EVENTS_PER_WINDOW = 30
const rateBuckets = new Map<string, { startedAt: number; count: number }>()

function cleanProperties(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(output).length >= 30) break
    if (typeof key !== "string" || key.length > 80) continue
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = typeof value === "string" ? value.slice(0, 500) : value
    }
  }
  return output
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: "Invalid request" }, 400)
    }

    const eventName = normalizeString(body.event_name, 64)
    if (!eventName || !ALLOWED_EVENTS.has(eventName)) {
      return json({ error: "Invalid event_name" }, 400)
    }

    const visitorId = normalizeString(body.visitor_id, 128)
    const sessionId = normalizeString(body.session_id, 128)
    if (!visitorId || !sessionId) {
      return json({ error: "visitor_id and session_id are required" }, 400)
    }

    const clientIp = normalizeString(body.client_ip, 64)
    const ipHash = clientIp ? await hmacIp(clientIp, Deno.env.get("SUPABASE_SECRET_KEY") ?? "") : null
    if (ipHash) {
      const now = Date.now()
      const bucket = rateBuckets.get(ipHash)
      if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
        rateBuckets.set(ipHash, { startedAt: now, count: 1 })
      } else {
        bucket.count += 1
        if (bucket.count > MAX_EVENTS_PER_WINDOW) return json({ error: "Rate limit exceeded" }, 429)
      }
      if (rateBuckets.size > 10_000) {
        for (const [key, value] of rateBuckets) {
          if (now - value.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key)
        }
      }
    }

    const geo = extractTrustedGeo(req, body)
    const userAgent = req.headers.get("user-agent") ?? ""
    const userId = typeof body.user_id === "string" ? body.user_id : null

    const payload = {
      event_name: eventName,
      visitor_id: visitorId,
      session_id: sessionId,
      user_id: userId,
      path: normalizeString(body.path, 500),
      referrer: normalizeString(body.referrer, 1000),
      ip_hash: ipHash,
      country_code: geo.countryCode,
      region: geo.region,
      city: geo.city,
      postal_code: geo.postalCode,
      location_source: geo.source === "unknown" ? null : geo.source,
      device_type: deviceFromUserAgent(userAgent),
      browser: browserFromUserAgent(userAgent),
      operating_system: osFromUserAgent(userAgent),
      properties: cleanProperties(body.properties),
    }

    const { error } = await ctx.supabaseAdmin.from("analytics_events").insert(payload)
    if (error) {
      console.error("analytics insert failed", error.message)
      return json({ error: "Unable to record event" }, 500)
    }

    return json({ ok: true }, 202)
  }),
}
