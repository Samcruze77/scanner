// Types + the single choke point for calling the deployed `admin-live`
// Edge Function. Read-only: who's online and what's happening, from
// live_sessions (presence) + analytics_events (activity feed).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface LiveSessionRow {
  session_id: string;
  user_id: string | null;
  label: string;
  path: string | null;
  tool: string | null;
  activity: string | null;
  device_type: string | null;
  browser: string | null;
  operating_system: string | null;
  country_code: string | null;
  region: string | null;
  started_at: string;
  last_seen: string;
  online: boolean;
}

export interface LiveActivityRow {
  event_name: string;
  label: string;
  path: string | null;
  device_type: string | null;
  country_code: string | null;
  region: string | null;
  properties: Record<string, unknown>;
  created_at: string;
}

export interface AdminLiveResponse {
  role: "super_admin" | "admin" | "analyst";
  definitions: { online_window_seconds: number; recently_active_window_seconds: number };
  online_count: number;
  sessions: LiveSessionRow[];
  activity: LiveActivityRow[];
}

export async function fetchAdminLive(supabase: SupabaseClient): Promise<AdminLiveResponse> {
  const { data, error } = await supabase.functions.invoke("admin-live", { method: "GET" });
  if (error) throw error;
  return data as AdminLiveResponse;
}
