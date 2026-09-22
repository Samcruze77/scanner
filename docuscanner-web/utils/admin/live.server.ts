import { cookies } from "next/headers";
import { createClient as createServerSupabaseClient } from "@/utils/supabase/server";
import { fetchAdminLive } from "./live";

export async function getAdminLive() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);
  return fetchAdminLive(supabase);
}
