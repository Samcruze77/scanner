"use client";

// Client-only wrapper around `admin-users` -- import from Client Components
// only. For Server Components use ./users.server.ts.

import { createClient as createBrowserClient } from "@/utils/supabase/client";
import { fetchAdminUsers, fetchAdminUserDetail, postAdminUserAction } from "./users";
import type { AdminUserAction, AdminUsersListFilters } from "./users";

export async function getAdminUsersBrowser(filters: AdminUsersListFilters = {}) {
  const supabase = createBrowserClient();
  return fetchAdminUsers(supabase, filters);
}

export async function getAdminUserDetailBrowser(id: string) {
  const supabase = createBrowserClient();
  return fetchAdminUserDetail(supabase, id);
}

export async function postAdminUserActionBrowser(body: AdminUserAction) {
  const supabase = createBrowserClient();
  return postAdminUserAction(supabase, body);
}
