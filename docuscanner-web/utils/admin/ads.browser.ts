"use client";

import { createClient as createBrowserClient } from "@/utils/supabase/client";
import {
  fetchAdCampaigns,
  fetchAdCampaignDetail,
  createCampaign,
  updateCampaign,
  duplicateCampaign,
  setCampaignStatus,
  deleteCampaign,
} from "./ads";
import type { CampaignFormFields, CampaignStatus } from "./ads";

export async function getAdCampaignsBrowser() {
  return fetchAdCampaigns(createBrowserClient());
}

export async function getAdCampaignDetailBrowser(id: string) {
  return fetchAdCampaignDetail(createBrowserClient(), id);
}

export async function createCampaignBrowser(fields: CampaignFormFields) {
  return createCampaign(createBrowserClient(), fields);
}

export async function updateCampaignBrowser(campaignId: string, fields: CampaignFormFields) {
  return updateCampaign(createBrowserClient(), campaignId, fields);
}

export async function duplicateCampaignBrowser(campaignId: string) {
  return duplicateCampaign(createBrowserClient(), campaignId);
}

export async function setCampaignStatusBrowser(campaignId: string, status: CampaignStatus) {
  return setCampaignStatus(createBrowserClient(), campaignId, status);
}

export async function deleteCampaignBrowser(campaignId: string) {
  return deleteCampaign(createBrowserClient(), campaignId);
}
