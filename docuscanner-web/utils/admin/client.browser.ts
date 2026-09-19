"use client";

// Client-only wrapper around `admin-analytics` -- import this from Client
// Components only. For Server Components use ./client.server.ts.
// See utils/admin/invoke.ts for the verified edge function contract.

import { createClient as createBrowserClient } from "@/utils/supabase/client";
import { fetchAdminAnalytics } from "./invoke";
import type { AdminAnalyticsResponse } from "./types";

export async function getAdminAnalyticsBrowser(
  from?: string,
  to?: string,
  days?: number,
): Promise<AdminAnalyticsResponse> {
  const supabase = createBrowserClient();
  return fetchAdminAnalytics(supabase, { from, to, days });
}
