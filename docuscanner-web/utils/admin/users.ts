// Types + the single choke point for calling the deployed `admin-users`
// Edge Function. Never query auth.users, admin_users, or live_sessions
// directly from the browser or a Server Component -- this is the only
// thing allowed to touch them, and it's what enforces the admin_users role
// check (and every self-target / last-super-admin guard) server-side.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  email_confirmed_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
  is_suspended: boolean;
  admin_role: "super_admin" | "admin" | "analyst" | null;
  scans: number;
  conversions: number;
  downloads: number;
  last_activity_at: string | null;
  online: boolean;
  recently_active: boolean;
}

export interface AdminUserDocument {
  id: string;
  title: string;
  file_size: number;
  page_count: number | null;
  mime_type: string;
  created_at: string;
}

export interface AdminUserEvent {
  event_name: string;
  path: string | null;
  properties: Record<string, unknown>;
  created_at: string;
}

export interface AdminUserSession {
  online: boolean;
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
}

export interface AdminUsersListResponse {
  role: "super_admin" | "admin" | "analyst";
  users: AdminUserRow[];
  total: number;
}

export interface AdminUserDetailResponse {
  role: "super_admin" | "admin" | "analyst";
  user: AdminUserRow;
  session: AdminUserSession | null;
  documents: AdminUserDocument[];
  recent_events: AdminUserEvent[];
}

export interface AdminUsersListFilters {
  q?: string;
  verified?: "true" | "false";
  activity_state?: "online" | "recent" | "inactive";
  signup_from?: string;
  signup_to?: string;
  activity_type?: "scans" | "conversions" | "downloads";
  limit?: number;
  offset?: number;
}

export async function fetchAdminUsers(
  supabase: SupabaseClient,
  filters: AdminUsersListFilters = {},
): Promise<AdminUsersListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  const { data, error } = await supabase.functions.invoke(`admin-users${query ? `?${query}` : ""}`, { method: "GET" });
  if (error) throw error;
  return data as AdminUsersListResponse;
}

export async function fetchAdminUserDetail(supabase: SupabaseClient, id: string): Promise<AdminUserDetailResponse> {
  const { data, error } = await supabase.functions.invoke(`admin-users?id=${encodeURIComponent(id)}`, { method: "GET" });
  if (error) throw error;
  return data as AdminUserDetailResponse;
}

export type AdminUserAction =
  | { action: "reset_password"; user_id: string; origin: string }
  | { action: "suspend"; user_id: string; reason?: string }
  | { action: "reactivate"; user_id: string }
  | { action: "delete"; user_id: string; confirm: true }
  | { action: "set_role"; user_id: string; role: "super_admin" | "admin" | "analyst" | null };

export async function postAdminUserAction(supabase: SupabaseClient, body: AdminUserAction): Promise<{ ok: true }> {
  const { data, error } = await supabase.functions.invoke("admin-users", { method: "POST", body });
  if (error) {
    // supabase-js surfaces a non-2xx edge function response as a generic
    // FunctionsHttpError; the actual { error: "..." } body is on context.
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const parsed = (await context.clone().json()) as { error?: string };
        if (parsed?.error) throw new Error(parsed.error);
      } catch {
        // fall through to generic error below
      }
    }
    throw error;
  }
  return data as { ok: true };
}
