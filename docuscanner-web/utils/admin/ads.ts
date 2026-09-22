// Types + the single choke point for calling the deployed `admin-ads`
// Edge Function. Never query ad_campaigns/ad_creatives/ad_events directly
// from the browser or a Server Component.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AdSlotCode = "top" | "side" | "bottom" | "inline";
export type DeviceVariant = "all" | "desktop" | "mobile";
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type EffectiveState = CampaignStatus | "scheduled";
export type DestinationType = "link" | "embed";

export interface AdCreative {
  id?: string;
  campaign_id?: string;
  slot_code: AdSlotCode;
  device_variant: DeviceVariant;
  asset_url: string;
  click_url: string;
  alt_text: string | null;
  title: string | null;
  description: string | null;
  cta_text: string | null;
  width: number | null;
  height: number | null;
  is_active: boolean;
  destination_type: DestinationType;
  embed_url: string | null;
}

export interface AdCampaign {
  id: string;
  name: string;
  advertiser_name: string;
  status: CampaignStatus;
  effective_state: EffectiveState;
  starts_at: string;
  ends_at: string;
  timezone: string;
  target_countries: string[];
  target_regions: string[];
  target_paths: string[];
  target_devices: string[];
  priority: number;
  frequency_cap_per_session: number | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdCampaignListRow extends AdCampaign {
  creative_count: number;
  impressions: number;
  clicks: number;
  ctr: number;
  has_events: boolean;
}

export interface AdCampaignsListResponse {
  role: "super_admin" | "admin" | "analyst";
  campaigns: AdCampaignListRow[];
}

export interface AdCampaignAnalytics {
  impressions: number;
  clicks: number;
  ctr: number;
  by_slot: { key: string; count: number }[];
  by_device: { key: string; count: number }[];
  by_country: { key: string; count: number }[];
  by_region: { key: string; count: number }[];
  by_path: { key: string; count: number }[];
  daily: { date: string; impressions: number; clicks: number }[];
}

export interface AdCampaignDetailResponse {
  role: "super_admin" | "admin" | "analyst";
  campaign: AdCampaign;
  creatives: AdCreative[];
  analytics: AdCampaignAnalytics;
}

export async function fetchAdCampaigns(supabase: SupabaseClient): Promise<AdCampaignsListResponse> {
  const { data, error } = await supabase.functions.invoke("admin-ads", { method: "GET" });
  if (error) throw error;
  return data as AdCampaignsListResponse;
}

export async function fetchAdCampaignDetail(supabase: SupabaseClient, id: string): Promise<AdCampaignDetailResponse> {
  const { data, error } = await supabase.functions.invoke(`admin-ads?id=${encodeURIComponent(id)}`, { method: "GET" });
  if (error) throw error;
  return data as AdCampaignDetailResponse;
}

export interface CampaignFormFields {
  name: string;
  advertiser_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  target_countries: string[];
  target_regions: string[];
  target_paths: string[];
  target_devices: string[];
  priority: number;
  frequency_cap_per_session: number | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  creatives: AdCreative[];
}

async function postAdsAction(supabase: SupabaseClient, body: Record<string, unknown>): Promise<{ ok: true; campaign_id?: string }> {
  const { data, error } = await supabase.functions.invoke("admin-ads", { method: "POST", body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const parsed = (await context.clone().json()) as { error?: string };
        if (parsed?.error) throw new Error(parsed.error);
      } catch {
        // fall through
      }
    }
    throw error;
  }
  return data as { ok: true; campaign_id?: string };
}

export function createCampaign(supabase: SupabaseClient, fields: CampaignFormFields) {
  return postAdsAction(supabase, { action: "create", ...fields });
}

export function updateCampaign(supabase: SupabaseClient, campaignId: string, fields: CampaignFormFields) {
  return postAdsAction(supabase, { action: "update", campaign_id: campaignId, ...fields });
}

export function duplicateCampaign(supabase: SupabaseClient, campaignId: string) {
  return postAdsAction(supabase, { action: "duplicate", campaign_id: campaignId });
}

export function setCampaignStatus(supabase: SupabaseClient, campaignId: string, status: CampaignStatus) {
  return postAdsAction(supabase, { action: "set_status", campaign_id: campaignId, status });
}

export function deleteCampaign(supabase: SupabaseClient, campaignId: string) {
  return postAdsAction(supabase, { action: "delete", campaign_id: campaignId });
}
