import { cookies } from "next/headers";
import { createClient as createServerSupabaseClient } from "@/utils/supabase/server";
import { fetchAdCampaigns, fetchAdCampaignDetail } from "./ads";

export async function getAdCampaigns() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);
  return fetchAdCampaigns(supabase);
}

export async function getAdCampaignDetail(id: string) {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);
  return fetchAdCampaignDetail(supabase, id);
}
