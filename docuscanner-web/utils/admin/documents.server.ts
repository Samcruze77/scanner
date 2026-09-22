import { cookies } from "next/headers";
import { createClient as createServerSupabaseClient } from "@/utils/supabase/server";
import { fetchAdminDocuments } from "./documents";

export async function getAdminDocuments() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);
  return fetchAdminDocuments(supabase);
}
