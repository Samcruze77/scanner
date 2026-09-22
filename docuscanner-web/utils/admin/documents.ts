// Site-wide view of only-intentionally-stored documents, via
// `admin-users?scope=documents`. Never anything browser-local -- the
// `documents` table only ever gets a row when a signed-in user explicitly
// saves to their account (see utils/documents/save.ts).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminDocumentRow {
  id: string;
  user_id: string;
  owner_label: string;
  title: string;
  file_size: number;
  page_count: number | null;
  mime_type: string;
  created_at: string;
}

export interface AdminDocumentsResponse {
  role: "super_admin" | "admin" | "analyst";
  documents: AdminDocumentRow[];
}

export async function fetchAdminDocuments(supabase: SupabaseClient): Promise<AdminDocumentsResponse> {
  const { data, error } = await supabase.functions.invoke("admin-users?scope=documents", { method: "GET" });
  if (error) throw error;
  return data as AdminDocumentsResponse;
}
