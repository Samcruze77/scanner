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
//   -> { role, range, filters, overview, breakdowns, geo, locations, daily }
//
// It does NOT support a `whoami` action or an export-job API -- do not call
// this for those; see app/admin/layout.tsx (role comes from this same GET
// response) and app/api/admin/analytics-export (file downloads).
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
  if (range.country) params.set("country", range.country);
  if (range.state_province) params.set("state_province", range.state_province);
  if (range.city_town) params.set("city_town", range.city_town);
  if (range.county_district_lga) params.set("county_district_lga", range.county_district_lga);
  if (range.neighborhood_suburb) params.set("neighborhood_suburb", range.neighborhood_suburb);
  if (range.device) params.set("device", range.device);
  if (range.visitorType) params.set("visitor_type", range.visitorType);

  const query = params.toString();
  const { data, error } = await supabase.functions.invoke(
    `admin-analytics${query ? `?${query}` : ""}`,
    { method: "GET" },
  );
  if (error) throw error;
  return data as AdminAnalyticsResponse;
}

// Role only (no analytics rows read). An older deployed function without
// `mode=role` ignores it and returns the full response, which also carries
// `role`, so this is safe to call before the function is redeployed.
export async function fetchAdminRole(supabase: SupabaseClient): Promise<AdminAnalyticsResponse["role"]> {
  const { data, error } = await supabase.functions.invoke("admin-analytics?mode=role", { method: "GET" });
  if (error) throw error;
  return (data as AdminAnalyticsResponse).role ?? null;
}
