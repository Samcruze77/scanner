// Admin audit trail, via `admin-users?scope=audit`. Every privileged action
// (password reset, suspend/reactivate/delete, role change, ad campaign
// create/edit/status change/delete) writes one row here server-side --
// never client-side, so a row can't be spoofed by the browser.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminAuditLogRow {
  id: number;
  admin_user_id: string | null;
  admin_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminAuditLogResponse {
  role: "super_admin" | "admin" | "analyst";
  logs: AdminAuditLogRow[];
}

export async function fetchAdminAuditLog(supabase: SupabaseClient): Promise<AdminAuditLogResponse> {
  const { data, error } = await supabase.functions.invoke("admin-users?scope=audit", { method: "GET" });
  if (error) throw error;
  return data as AdminAuditLogResponse;
}
