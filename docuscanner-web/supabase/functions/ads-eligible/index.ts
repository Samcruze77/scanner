
// Public ad-delivery endpoint. Given a slot + page + (server-derived)
// device/country, returns the one creative to render, or none. No auth --
// guests must be served ads too.
//
// The eligible campaign set (status='active' rows + their creatives) is
// cached in-memory on the warm function instance for 30s -- same
// warm-instance-cache technique as track-analytics' rate limiter -- so a
// page rendering several ad slots doesn't cost a DB round trip per slot,
// and campaign changes take effect within ~30s without a redeploy.
//
// The client is never trusted for eligibility: status, schedule (including
// day/time-of-day in the campaign's own timezone), targeting and rotation
// are all decided here, server-side, from the cached DB state.

import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=20" },
  })
}

const CACHE_TTL_MS = 30 * 1000
const SLOTS = new Set(["top", "side", "bottom", "inline"])

function deviceFromUserAgent(ua: string) {
  const value = ua.toLowerCase()
  if (/ipad|tablet|kindle|silk/.test(value)) return "tablet"
  if (/mobile|iphone|android/.test(value)) return "mobile"
  return "desktop"
}

interface Creative {
  id: string
  campaign_id: string
  slot_code: string
  device_variant: string
  asset_url: string
  click_url: string
  alt_text: string | null
  title: string | null
  description: string | null
  cta_text: string | null
  width: number | null
  height: number | null
  is_active: boolean
  destination_type: string
  embed_url: string | null
}

interface Campaign {
  id: string
  status: string
  starts_at: string
  ends_at: string
  timezone: string
  target_countries: string[]
  target_regions: string[]
  target_paths: string[]
  target_devices: string[]
  priority: number
  frequency_cap_per_session: number | null
  days_of_week: number[] | null
  start_time: string | null
  end_time: string | null
  creatives: Creative[]
}

let cache: { at: number; campaigns: Campaign[] } | null = null

async function getActiveCampaigns(): Promise<Campaign[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.campaigns

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const [{ data: campaigns }, { data: creatives }] = await Promise.all([
    admin
      .from("ad_campaigns")
      .select("id,status,starts_at,ends_at,timezone,target_countries,target_regions,target_paths,target_devices,priority,frequency_cap_per_session,days_of_week,start_time,end_time")
      .eq("status", "active"),
    admin.from("ad_creatives").select("*").eq("is_active", true),
  ])

  const creativesByCampaign = new Map<string, Creative[]>()
  for (const c of (creatives ?? []) as Creative[]) {
    const list = creativesByCampaign.get(c.campaign_id) ?? []
    list.push(c)
    creativesByCampaign.set(c.campaign_id, list)
  }

  const result = ((campaigns ?? []) as Omit<Campaign, "creatives">[]).map((c) => ({
    ...c,
    creatives: creativesByCampaign.get(c.id) ?? [],
  }))

  cache = { at: Date.now(), campaigns: result }
  return result
}

function dayAndTimeInTimezone(timezone: string): { day: number; minutes: number } | null {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now)
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
    if (!(weekday in weekdayMap)) return null
    return { day: weekdayMap[weekday], minutes: hour * 60 + minute }
  } catch {
    return null
  }
}

function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

function isCampaignEligibleNow(c: Campaign, path: string, device: string, country: string | null, region: string | null): boolean {
  const now = Date.now()
  if (new Date(c.starts_at).getTime() > now) return false
  if (new Date(c.ends_at).getTime() < now) return false

  if (c.days_of_week && c.days_of_week.length > 0) {
    const dt = dayAndTimeInTimezone(c.timezone)
    if (!dt || !c.days_of_week.includes(dt.day)) return false
    if (c.start_time && c.end_time) {
      const startMin = timeStringToMinutes(c.start_time)
      const endMin = timeStringToMinutes(c.end_time)
      if (dt.minutes < startMin || dt.minutes > endMin) return false
    }
  } else if (c.start_time && c.end_time) {
    const dt = dayAndTimeInTimezone(c.timezone)
    if (!dt) return false
    const startMin = timeStringToMinutes(c.start_time)
    const endMin = timeStringToMinutes(c.end_time)
    if (dt.minutes < startMin || dt.minutes > endMin) return false
  }

  if (c.target_paths.length > 0 && !c.target_paths.includes(path)) return false
  if (c.target_devices.length > 0 && !c.target_devices.includes(device)) return false
  if (c.target_countries.length > 0 && (!country || !c.target_countries.includes(country))) return false
  if (c.target_regions.length > 0 && (!region || !c.target_regions.includes(region))) return false

  return true
}

function pickCreative(c: Campaign, slot: string, device: string): Creative | null {
  const forSlot = c.creatives.filter((cr) => cr.slot_code === slot && cr.is_active)
  if (forSlot.length === 0) return null
  const deviceSpecific = forSlot.find((cr) => cr.device_variant === device)
  return deviceSpecific ?? forSlot.find((cr) => cr.device_variant === "all") ?? null
}

function weightedPick(campaigns: Campaign[]): Campaign | null {
  const totalWeight = campaigns.reduce((sum, c) => sum + Math.max(c.priority, 1), 0)
  if (totalWeight <= 0) return null
  let roll = Math.random() * totalWeight
  for (const c of campaigns) {
    roll -= Math.max(c.priority, 1)
    if (roll <= 0) return c
  }
  return campaigns[campaigns.length - 1]
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405)

  try {
    const url = new URL(req.url)
    const slot = url.searchParams.get("slot") ?? ""
    const path = (url.searchParams.get("path") ?? "/").slice(0, 300)
    if (!SLOTS.has(slot)) return json({ campaign: null })

    const userAgent = req.headers.get("user-agent") ?? ""
    const device = deviceFromUserAgent(userAgent)
    const country = (req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country") ?? "").toUpperCase() || null
    const region = req.headers.get("x-vercel-ip-country-region") || null

    const campaigns = await getActiveCampaigns()
    const eligible = campaigns.filter(
      (c) => isCampaignEligibleNow(c, path, device, country, region) && pickCreative(c, slot, device) !== null,
    )
    if (eligible.length === 0) return json({ campaign: null })

    const chosen = weightedPick(eligible)
    if (!chosen) return json({ campaign: null })
    const creative = pickCreative(chosen, slot, device)
    if (!creative) return json({ campaign: null })

    return json({
      campaign: {
        campaign_id: chosen.id,
        creative_id: creative.id,
        slot_code: creative.slot_code,
        asset_url: creative.asset_url,
        click_url: creative.click_url,
        alt_text: creative.alt_text,
        title: creative.title,
        description: creative.description,
        cta_text: creative.cta_text,
        width: creative.width,
        height: creative.height,
        destination_type: creative.destination_type,
        embed_url: creative.embed_url,
        frequency_cap_per_session: chosen.frequency_cap_per_session,
      },
    })
  } catch {
    // Ad delivery must never break the page it's embedded in.
    return json({ campaign: null })
  }
})
