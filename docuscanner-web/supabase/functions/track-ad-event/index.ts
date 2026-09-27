// Public ad impression/click recorder. Called ONLY by this app's own
// /api/analytics/ad-event Route Handler now -- see
// supabase/functions/track-analytics/index.ts for the trust model.
//
// Every event is still validated against the real campaign/creative
// relationship before being written, so a caller can't manufacture events
// against a nonexistent, unrelated, or never-launched campaign:
//   - campaign_id and creative_id must both exist
//   - the creative must actually belong to that campaign
//   - the campaign must be in a state that could plausibly have served it
//     (active/paused/completed -- never draft or archived)
// This is reasonable-effort integrity, not cryptographic proof of delivery.

import { withSupabase } from "npm:@supabase/server"
import { normalizeString, extractTrustedGeo, deviceFromUserAgent, corsHeaders, json } from "../_shared/geo.ts"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

    const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : ""
    const creativeId = typeof body.creative_id === "string" ? body.creative_id : ""
    const eventType = body.event_type === "impression" || body.event_type === "click" ? body.event_type : null
    const path = normalizeString(body.path, 300)

    if (!UUID_RE.test(campaignId) || !UUID_RE.test(creativeId) || !eventType) {
      return json({ error: "Invalid event" }, 400)
    }

    const admin = ctx.supabaseAdmin

    const { data: creative } = await admin
      .from("ad_creatives")
      .select("id,campaign_id,slot_code")
      .eq("id", creativeId)
      .eq("campaign_id", campaignId)
      .maybeSingle()
    if (!creative) return json({ error: "Unknown campaign/creative" }, 400)

    const { data: campaign } = await admin.from("ad_campaigns").select("status").eq("id", campaignId).maybeSingle()
    if (!campaign || campaign.status === "draft" || campaign.status === "archived") {
      return json({ error: "Campaign is not eligible to record events" }, 400)
    }

    const geo = extractTrustedGeo(req, body)
    const userAgent = req.headers.get("user-agent") ?? ""
    const userId = typeof body.user_id === "string" ? body.user_id : null
    const sessionId = normalizeString(body.session_id, 128)

    const { error } = await admin.from("ad_events").insert({
      campaign_id: campaignId,
      creative_id: creativeId,
      event_type: eventType,
      slot_code: creative.slot_code,
      user_id: userId,
      session_id: sessionId,
      device_type: deviceFromUserAgent(userAgent),
      country_code: geo.countryCode,
      region: geo.region,
      city: geo.city,
      postal_code: geo.postalCode,
      location_source: geo.source === "unknown" ? null : geo.source,
      path,
    })
    if (error) return json({ error: "Unable to record event" }, 500)

    return json({ ok: true }, 202)
  }),
}
