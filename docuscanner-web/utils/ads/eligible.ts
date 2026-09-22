"use client";

// Client-side wrapper around the public `ads-eligible` / `track-ad-event`
// Edge Functions. Ad loading is strictly non-critical: every call here is
// wrapped so a slow/failed ad request can never throw, block, or delay the
// scanner/converter workflow it's rendered next to -- on any failure this
// just resolves to "no ad," identical to today's placeholder state.
//
// Frequency capping (impressions per session) is enforced here, client-side,
// using the same session identity already established by analytics
// (utils/analytics/identity.ts) -- no extra DB writes, no new tracking.

import { getSessionId, getVisitorId } from "@/utils/analytics/identity";
import type { AdSlotCode } from "@/utils/admin/ads";

const FUNCTIONS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
const REQUEST_TIMEOUT_MS = 2500;
const IMPRESSION_KEY_PREFIX = "ds_ad_seen_";

export interface EligibleAd {
  campaign_id: string;
  creative_id: string;
  slot_code: AdSlotCode;
  asset_url: string;
  click_url: string;
  alt_text: string | null;
  title: string | null;
  description: string | null;
  cta_text: string | null;
  width: number | null;
  height: number | null;
  destination_type: "link" | "embed";
  embed_url: string | null;
  frequency_cap_per_session: number | null;
}

function impressionCount(campaignId: string): number {
  try {
    return Number(sessionStorage.getItem(IMPRESSION_KEY_PREFIX + campaignId) ?? "0");
  } catch {
    return 0;
  }
}

function recordImpressionLocally(campaignId: string): void {
  try {
    sessionStorage.setItem(IMPRESSION_KEY_PREFIX + campaignId, String(impressionCount(campaignId) + 1));
  } catch {
    // sessionStorage unavailable (private mode, quota) -- frequency capping
    // just won't apply this session; never throw from here.
  }
}

export async function getEligibleAd(slot: AdSlotCode, path: string): Promise<EligibleAd | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${FUNCTIONS_URL}/ads-eligible?slot=${slot}&path=${encodeURIComponent(path)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { campaign: EligibleAd | null };
    const ad = data.campaign;
    if (!ad) return null;
    if (ad.frequency_cap_per_session !== null && impressionCount(ad.campaign_id) >= ad.frequency_cap_per_session) {
      return null;
    }
    return ad;
  } catch {
    return null;
  }
}

export function trackAdImpressionEvent(ad: EligibleAd, path: string): void {
  recordImpressionLocally(ad.campaign_id);
  void sendAdEvent(ad, "impression", path);
}

export function trackAdClickEvent(ad: EligibleAd, path: string): void {
  void sendAdEvent(ad, "click", path);
}

async function sendAdEvent(ad: EligibleAd, eventType: "impression" | "click", path: string): Promise<void> {
  try {
    await fetch(`${FUNCTIONS_URL}/track-ad-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign_id: ad.campaign_id,
        creative_id: ad.creative_id,
        event_type: eventType,
        path,
        session_id: getSessionId(),
        visitor_id: getVisitorId(),
      }),
      keepalive: true,
    });
  } catch {
    // Tracking must never surface an error to the user.
  }
}
