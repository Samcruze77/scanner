// Server-only wrapper around `admin-analytics` -- import this from Server
// Components / layouts only. For Client Components use ./client.browser.ts.
// See utils/admin/invoke.ts for the verified edge function contract.

import { cache } from "react";
import { cookies } from "next/headers";
import { createClient as createServerSupabaseClient } from "@/utils/supabase/server";
import { fetchAdminAnalytics } from "./invoke";
import type { AdminAnalyticsResponse } from "./types";

// Wrapped in React's cache() so the layout's role check and the page's data
// fetch -- both called with the same (from, to) for a given request --
// dedupe into a single call to the edge function instead of two. cache()
// keys on primitive argument equality, hence separate string params rather
// than a range object.
export const getAdminAnalytics = cache(
  async (from?: string, to?: string, days?: number): Promise<AdminAnalyticsResponse> => {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    return fetchAdminAnalytics(supabase, { from, to, days });
  },
);
