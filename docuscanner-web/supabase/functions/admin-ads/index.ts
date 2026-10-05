
// Super Admin ad/campaign management API. GET lists/details campaigns with
// their creatives and analytics (from ad_events); POST creates/edits/
// transitions/deletes them. Same admin_users role-gate pattern as the rest
// of the admin API surface. super_admin/admin only (analyst is read-only
// here, unlike the general analytics dashboard, since campaigns control
// real money-bearing content).
//
// Campaigns are pure data: image/video URL + click URL + text fields.
// Nothing here ever stores or renders advertiser HTML/JS.
//
// Deletion rule: a campaign that has ever recorded an ad_event (impression
// or click) cannot be hard-deleted -- only Archived -- because
// ad_events.campaign_id is ON DELETE CASCADE and deleting would silently
// destroy its analytics history. A campaign with zero events (never
// launched) can be deleted outright.

import { withSupabase } from "npm:@supabase/server"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

const SLOTS = new Set(["top", "side", "bottom", "inline"])
const DEVICE_VARIANTS = new Set(["all", "desktop", "mobile"])
const DEVICES = new Set(["desktop", "tablet", "mobile"])
const DESTINATION_TYPES = new Set(["link", "embed"])
const MEDIA_TYPES = new Set(["image", "video"])
// Only assets actually uploaded through utils/admin/uploadAdAsset.ts (see
// EXT_BY_TYPE there) end in one of these -- anything else claiming a
// storage_path is rejected outright rather than trusted from the client.
const AD_ASSET_EXTENSIONS = new Set(["jpg", "png", "webp", "gif", "mp4", "webm"])
// Explicit allowlist of hosts that may be embedded via iframe. Nothing else
// is ever accepted, regardless of what the admin pastes -- this is the only
// thing standing between "supported embed" and an open iframe redirector.
const EMBED_HOST_ALLOWLIST = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
])
const STATUSES = new Set(["draft", "active", "paused", "completed", "archived"])
const STATUS_AUDIT_ACTION: Record<string, string> = {
  draft: "campaign_set_draft",
  active: "campaign_activated",
  paused: "campaign_paused",
  completed: "campaign_ended",
  archived: "campaign_archived",
}

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "")

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const u = new URL(value)
    return u.protocol === "https:"
  } catch {
    return false
  }
}

function str(value: unknown, max = 300): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null
}

function strArray(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string").slice(0, 40).map((v) => v.trim().slice(0, max)).filter(Boolean)
}

function effectiveState(c: { status: string; starts_at: string; ends_at: string }): string {
  if (c.status !== "active") return c.status
  const now = Date.now()
  if (new Date(c.starts_at).getTime() > now) return "scheduled"
  if (new Date(c.ends_at).getTime() < now) return "completed"
  return "active"
}

interface CreativeInput {
  slot_code: string
  device_variant?: string
  asset_url: string
  click_url: string
  alt_text?: string | null
  title?: string | null
  description?: string | null
  cta_text?: string | null
  width?: number | null
  height?: number | null
  is_active?: boolean
  destination_type?: string
  embed_url?: string | null
  media_type: string
  storage_path: string | null
  mime_type: string | null
  file_size_bytes: number | null
}

function isAllowlistedEmbedUrl(value: unknown): value is string {
  if (!isHttpsUrl(value)) return false
  try {
    return EMBED_HOST_ALLOWLIST.has(new URL(value).hostname.toLowerCase())
  } catch {
    return false
  }
}

// A storage_path is only trustworthy if it (a) has one of the extensions
// our own upload helper ever writes, and (b) the paired asset_url is
// exactly the public URL Supabase Storage serves for that path in our own
// project -- never an arbitrary asset_url paired with a spoofed path.
function validateOwnedAsset(storagePath: string, assetUrl: string): boolean {
  const ext = storagePath.split(".").pop()?.toLowerCase()
  if (!ext || !AD_ASSET_EXTENSIONS.has(ext)) return false
  if (storagePath.includes("..") || storagePath.startsWith("/")) return false
  if (!SUPABASE_URL) return true // can't verify in a local/dev env without the URL; extension check still applied
  const expected = `${SUPABASE_URL}/storage/v1/object/public/ad-assets/${storagePath}`
  return assetUrl === expected
}

function validateCreatives(input: unknown): { ok: true; creatives: CreativeInput[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "At least one creative is required" }
  const creatives: CreativeInput[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid creative" }
    const c = raw as Record<string, unknown>
    const slot = str(c.slot_code, 20)
    if (!slot || !SLOTS.has(slot)) return { ok: false, error: `Invalid slot_code: ${String(c.slot_code)}` }
    const deviceVariant = str(c.device_variant, 20) ?? "all"
    if (!DEVICE_VARIANTS.has(deviceVariant)) return { ok: false, error: `Invalid device_variant: ${deviceVariant}` }
    if (!isHttpsUrl(c.asset_url)) return { ok: false, error: "asset_url must be a valid https URL" }
    if (!isHttpsUrl(c.click_url)) return { ok: false, error: "click_url must be a valid https URL" }

    const mediaType = str(c.media_type, 10) ?? "image"
    if (!MEDIA_TYPES.has(mediaType)) return { ok: false, error: `Invalid media_type: ${mediaType}` }

    const storagePath = str(c.storage_path, 300)
    if (storagePath && !validateOwnedAsset(storagePath, c.asset_url as string)) {
      return { ok: false, error: "storage_path does not match a valid uploaded ad asset" }
    }

    const destinationType = str(c.destination_type, 20) ?? "link"
    if (!DESTINATION_TYPES.has(destinationType)) return { ok: false, error: `Invalid destination_type: ${destinationType}` }
    let embedUrl: string | null = null
    if (destinationType === "embed") {
      if (!isAllowlistedEmbedUrl(c.embed_url)) {
        return { ok: false, error: "embed_url must be an https URL from a supported provider (YouTube or Vimeo)" }
      }
      embedUrl = c.embed_url as string
    }

    creatives.push({
      slot_code: slot,
      device_variant: deviceVariant,
      asset_url: c.asset_url as string,
      click_url: c.click_url as string,
      alt_text: str(c.alt_text, 200),
      title: str(c.title, 120),
      description: str(c.description, 300),
      cta_text: str(c.cta_text, 40),
      width: typeof c.width === "number" ? c.width : null,
      height: typeof c.height === "number" ? c.height : null,
      is_active: c.is_active !== false,
      destination_type: destinationType,
      embed_url: embedUrl,
      media_type: mediaType,
      storage_path: storagePath,
      mime_type: str(c.mime_type, 100),
      file_size_bytes: typeof c.file_size_bytes === "number" && c.file_size_bytes >= 0 ? Math.round(c.file_size_bytes) : null,
    })
  }
  return { ok: true, creatives }
}

function validateCampaignFields(body: Record<string, unknown>): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const name = str(body.name, 200)
  const advertiserName = str(body.advertiser_name, 200)
  if (!name) return { ok: false, error: "name is required" }
  if (!advertiserName) return { ok: false, error: "advertiser_name is required" }

  const startsAt = typeof body.starts_at === "string" ? body.starts_at : null
  const endsAt = typeof body.ends_at === "string" ? body.ends_at : null
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) return { ok: false, error: "starts_at is required and must be a valid date" }
  if (!endsAt || Number.isNaN(new Date(endsAt).getTime())) return { ok: false, error: "ends_at is required and must be a valid date" }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return { ok: false, error: "ends_at must be after starts_at" }

  const timezone = str(body.timezone, 60) ?? "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone })
  } catch {
    return { ok: false, error: `Invalid timezone: ${timezone}` }
  }

  const targetDevices = strArray(body.target_devices, 20).filter((d) => DEVICES.has(d))
  const priority = typeof body.priority === "number" && body.priority >= 0 && body.priority <= 100 ? Math.round(body.priority) : 5
  const frequencyCap =
    typeof body.frequency_cap_per_session === "number" && body.frequency_cap_per_session > 0
      ? Math.round(body.frequency_cap_per_session)
      : null

  let daysOfWeek: number[] | null = null
  if (Array.isArray(body.days_of_week) && body.days_of_week.length > 0) {
    const days = body.days_of_week.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
    if (days.length > 0) daysOfWeek = days
  }

  const startTime = typeof body.start_time === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(body.start_time) ? body.start_time : null
  const endTime = typeof body.end_time === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(body.end_time) ? body.end_time : null

  return {
    ok: true,
    fields: {
      name,
      advertiser_name: advertiserName,
      starts_at: startsAt,
      ends_at: endsAt,
      timezone,
      target_countries: strArray(body.target_countries, 8).map((c) => c.toUpperCase()),
      target_regions: strArray(body.target_regions, 120),
      target_paths: strArray(body.target_paths, 300),
      target_devices: targetDevices,
      priority,
      frequency_cap_per_session: frequencyCap,
      days_of_week: daysOfWeek,
      start_time: startTime,
      end_time: endTime,
    },
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

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
    const admin = ctx.supabaseAdmin

    async function writeAudit(action: string, targetId: string | null, metadata: Record<string, unknown>) {
      await admin.from("admin_audit_logs").insert({ admin_user_id: userId, action, target_type: "ad_campaign", target_id: targetId, metadata })
    }

    if (req.method === "GET") {
      const url = new URL(req.url)
      const id = url.searchParams.get("id")

      const [{ data: campaigns }, { data: creatives }] = await Promise.all([
        admin.from("ad_campaigns").select("*").order("created_at", { ascending: false }),
        admin.from("ad_creatives").select("*"),
      ])

      const creativesByCampaign = new Map<string, typeof creatives>()
      for (const c of creatives ?? []) {
        const list = creativesByCampaign.get(c.campaign_id) ?? []
        list.push(c)
        creativesByCampaign.set(c.campaign_id, list)
      }

      if (id) {
        const campaign = (campaigns ?? []).find((c) => c.id === id)
        if (!campaign) return response({ error: "Not found" }, 404)

        const { data: events } = await admin
          .from("ad_events")
          .select("event_type,slot_code,device_type,country_code,region,path,created_at")
          .eq("campaign_id", id)
          .order("created_at", { ascending: false })
          .limit(50000)

        const rows = events ?? []
        const impressions = rows.filter((r) => r.event_type === "impression").length
        const clicks = rows.filter((r) => r.event_type === "click").length
        const topCounts = (values: (string | null)[]) => {
          const counts = new Map<string, number>()
          for (const v of values) {
            if (!v) continue
            counts.set(v, (counts.get(v) ?? 0) + 1)
          }
          return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([key, count]) => ({ key, count }))
        }
        const dailyMap = new Map<string, { impressions: number; clicks: number }>()
        for (const r of rows) {
          const date = String(r.created_at).slice(0, 10)
          const entry = dailyMap.get(date) ?? { impressions: 0, clicks: 0 }
          if (r.event_type === "impression") entry.impressions += 1
          if (r.event_type === "click") entry.clicks += 1
          dailyMap.set(date, entry)
        }
        const daily = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, e]) => ({ date, ...e }))

        return response({
          role,
          campaign: { ...campaign, effective_state: effectiveState(campaign) },
          creatives: creativesByCampaign.get(id) ?? [],
          analytics: {
            impressions,
            clicks,
            ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
            by_slot: topCounts(rows.map((r) => r.slot_code)),
            by_device: topCounts(rows.map((r) => r.device_type)),
            by_country: topCounts(rows.map((r) => r.country_code)),
            by_region: topCounts(rows.map((r) => r.region)),
            by_path: topCounts(rows.map((r) => r.path)),
            daily,
          },
        })
      }

      const { data: eventCounts } = await admin.from("ad_events").select("campaign_id,event_type")
      const statsByCampaign = new Map<string, { impressions: number; clicks: number }>()
      for (const e of eventCounts ?? []) {
        const entry = statsByCampaign.get(e.campaign_id) ?? { impressions: 0, clicks: 0 }
        if (e.event_type === "impression") entry.impressions += 1
        if (e.event_type === "click") entry.clicks += 1
        statsByCampaign.set(e.campaign_id, entry)
      }

      const list = (campaigns ?? []).map((c) => {
        const stats = statsByCampaign.get(c.id) ?? { impressions: 0, clicks: 0 }
        return {
          ...c,
          effective_state: effectiveState(c),
          creative_count: creativesByCampaign.get(c.id)?.length ?? 0,
          impressions: stats.impressions,
          clicks: stats.clicks,
          ctr: stats.impressions > 0 ? Number(((stats.clicks / stats.impressions) * 100).toFixed(2)) : 0,
          has_events: stats.impressions > 0 || stats.clicks > 0,
        }
      })

      return response({ role, campaigns: list })
    }

    if (req.method !== "POST") return response({ error: "Method not allowed" }, 405)
    if (role === "analyst") return response({ error: "Forbidden" }, 403)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return response({ error: "Invalid JSON" }, 400)
    }
    const action = typeof body.action === "string" ? body.action : ""

    if (action === "create") {
      const validated = validateCampaignFields(body)
      if (!validated.ok) return response({ error: validated.error }, 400)
      const creativesResult = validateCreatives(body.creatives)
      if (!creativesResult.ok) return response({ error: creativesResult.error }, 400)

      const { data: campaign, error } = await admin
        .from("ad_campaigns")
        .insert({ ...validated.fields, status: "draft" })
        .select("id")
        .single()
      if (error || !campaign) return response({ error: "Unable to create campaign" }, 500)

      const { error: creativeError } = await admin
        .from("ad_creatives")
        .insert(creativesResult.creatives.map((c) => ({ ...c, campaign_id: campaign.id })))
      if (creativeError) {
        await admin.from("ad_campaigns").delete().eq("id", campaign.id)
        return response({ error: "Unable to create creatives" }, 500)
      }

      await writeAudit("campaign_created", campaign.id, { name: validated.fields.name })
      return response({ ok: true, campaign_id: campaign.id })
    }

    const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : ""
    if (!campaignId) return response({ error: "campaign_id is required" }, 400)

    const { data: existing } = await admin.from("ad_campaigns").select("*").eq("id", campaignId).maybeSingle()
    if (!existing) return response({ error: "Campaign not found" }, 404)

    if (action === "update") {
      const validated = validateCampaignFields(body)
      if (!validated.ok) return response({ error: validated.error }, 400)
      const creativesResult = validateCreatives(body.creatives)
      if (!creativesResult.ok) return response({ error: creativesResult.error }, 400)

      const changed: string[] = []
      if (existing.name !== validated.fields.name || existing.advertiser_name !== validated.fields.advertiser_name) changed.push("details")
      if (existing.starts_at !== validated.fields.starts_at || existing.ends_at !== validated.fields.ends_at || existing.timezone !== validated.fields.timezone) changed.push("schedule")
      if (JSON.stringify(existing.target_paths) !== JSON.stringify(validated.fields.target_paths) || JSON.stringify(existing.target_countries) !== JSON.stringify(validated.fields.target_countries)) changed.push("targeting")
      changed.push("creative")

      const { error } = await admin.from("ad_campaigns").update(validated.fields).eq("id", campaignId)
      if (error) return response({ error: "Unable to update campaign" }, 500)

      // Storage objects belonging to creatives being replaced/removed are
      // cleaned up client-side (AdAssetUploader/CampaignForm) before this
      // call, since the client is the one that knows which paths changed.
      await admin.from("ad_creatives").delete().eq("campaign_id", campaignId)
      const { error: creativeError } = await admin
        .from("ad_creatives")
        .insert(creativesResult.creatives.map((c) => ({ ...c, campaign_id: campaignId })))
      if (creativeError) return response({ error: "Unable to update creatives" }, 500)

      await writeAudit("campaign_edited", campaignId, { changed })
      return response({ ok: true })
    }

    if (action === "duplicate") {
      const { data: creatives } = await admin.from("ad_creatives").select("*").eq("campaign_id", campaignId)
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = existing
      const { data: copy, error } = await admin
        .from("ad_campaigns")
        .insert({ ...rest, name: `${existing.name} (Copy)`, status: "draft" })
        .select("id")
        .single()
      if (error || !copy) return response({ error: "Unable to duplicate campaign" }, 500)

      if (creatives && creatives.length > 0) {
        // A creative that owns an uploaded asset (storage_path set) gets its
        // OWN copy of the underlying Storage object, not a second reference
        // to the same one -- otherwise replacing/deleting the asset on
        // either campaign's creative later would silently break the other.
        const copiedCreatives = await Promise.all(
          creatives.map(async ({ id: _cid, campaign_id: _cc, created_at: _cca, ...c }) => {
            if (!c.storage_path) return { ...c, campaign_id: copy.id }
            const newPath = `${copy.id}/${crypto.randomUUID()}.${c.storage_path.split(".").pop()}`
            const { error: copyError } = await admin.storage.from("ad-assets").copy(c.storage_path, newPath)
            if (copyError) return { ...c, campaign_id: copy.id, storage_path: null, asset_url: c.asset_url }
            const { data: publicUrl } = admin.storage.from("ad-assets").getPublicUrl(newPath)
            return { ...c, campaign_id: copy.id, storage_path: newPath, asset_url: publicUrl.publicUrl }
          }),
        )
        await admin.from("ad_creatives").insert(copiedCreatives)
      }
      await writeAudit("campaign_duplicated", copy.id, { source_campaign_id: campaignId })
      return response({ ok: true, campaign_id: copy.id })
    }

    if (action === "set_status") {
      const status = typeof body.status === "string" ? body.status : ""
      if (!STATUSES.has(status)) return response({ error: "Invalid status" }, 400)

      const { error } = await admin.from("ad_campaigns").update({ status }).eq("id", campaignId)
      if (error) return response({ error: "Unable to update status" }, 500)

      await writeAudit(STATUS_AUDIT_ACTION[status] ?? "campaign_status_changed", campaignId, { from: existing.status, to: status })
      return response({ ok: true })
    }

    if (action === "delete") {
      const { count } = await admin.from("ad_events").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId)
      if ((count ?? 0) > 0) {
        return response({ error: "This campaign has recorded impressions/clicks and cannot be deleted -- archive it instead" }, 400)
      }
      // Each creative's uploaded asset (if any) is this campaign's own copy
      // (see "duplicate" above), so it's always safe to remove here -- never
      // shared with another campaign's creative.
      const { data: creatives } = await admin.from("ad_creatives").select("storage_path").eq("campaign_id", campaignId)
      const paths = (creatives ?? []).map((c) => c.storage_path).filter((p): p is string => !!p)
      if (paths.length > 0) await admin.storage.from("ad-assets").remove(paths)

      const { error } = await admin.from("ad_campaigns").delete().eq("id", campaignId)
      if (error) return response({ error: "Unable to delete campaign" }, 500)

      await writeAudit("campaign_deleted", campaignId, { name: existing.name })
      return response({ ok: true })
    }

    return response({ error: "Unknown action" }, 400)
  }),
}
