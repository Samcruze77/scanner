import { cookies } from "next/headers";
import { createClient as createServerSupabaseClient } from "@/utils/supabase/server";
import { fetchAdminAuditLog } from "./audit";

export async function getAdminAuditLog() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);
  return fetchAdminAuditLog(supabase);
}
