// Single choke point for calling the deployed `admin-analytics` Edge
// Function. Never query analytics_events, admin_users, or
// analytics_export_jobs directly from the browser or a Server Component --
// this function is the only thing allowed to touch them, and it's what
// enforces the admin_users role check server-side.
//
// VERIFIED LIVE CONTRACT:
//   GET {SUPABASE_URL}/functions/v1/admin-analytics?from=&to=&days=
//   Authorization: Bearer <caller's Supabase access token> (attached
//     automatically by supabase-js's functions.invoke when a session exists)
//   -> { role, range, overview, breakdowns, daily }
//
// It does NOT support a `whoami` action or an export-job API -- do not call
// this for those; see app/admin/layout.tsx (role comes from this same GET
// response) and utils/admin/exportClient.ts (isolated, not-yet-connected).
//
// supabase-js's FunctionsClient builds its request URL as
// `${functionsUrl}/${functionName}`, so a query string appended to
// `functionName` ends up in the right place once `new URL()` parses it --
// that's how GET params are passed here since `invoke()` has no dedicated
// params option.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminAnalyticsRange, AdminAnalyticsResponse } from "./types";

export async function fetchAdminAnalytics(
  supabase: SupabaseClient,
  range: AdminAnalyticsRange = {},
): Promise<AdminAnalyticsResponse> {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  if (range.days) params.set("days", String(range.days));

  const query = params.toString();
  const { data, error } = await supabase.functions.invoke(
    `admin-analytics${query ? `?${query}` : ""}`,
    { method: "GET" },
  );
  if (error) throw error;
  return data as AdminAnalyticsResponse;
}
