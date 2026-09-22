"use client";

import { createClient as createBrowserClient } from "@/utils/supabase/client";
import { fetchAdminLive } from "./live";

export async function getAdminLiveBrowser() {
  const supabase = createBrowserClient();
  return fetchAdminLive(supabase);
}
