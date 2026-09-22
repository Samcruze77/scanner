// Server-only wrapper around `admin-users` -- import from Server Components
// only. For Client Components use ./users.browser.ts.

import { cookies } from "next/headers";
import { createClient as createServerSupabaseClient } from "@/utils/supabase/server";
import { fetchAdminUsers, fetchAdminUserDetail } from "./users";
import type { AdminUsersListFilters } from "./users";

export async function getAdminUsers(filters: AdminUsersListFilters = {}) {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);
  return fetchAdminUsers(supabase, filters);
}

export async function getAdminUserDetail(id: string) {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);
  return fetchAdminUserDetail(supabase, id);
}
