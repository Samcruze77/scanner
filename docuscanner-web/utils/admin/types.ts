// Shared types for the Super Admin analytics area, matching the VERIFIED
// live `admin-analytics` Edge Function contract:
//
//   GET {SUPABASE_URL}/functions/v1/admin-analytics?from=&to=&days=
//   Authorization: Bearer <caller's Supabase access token>
//   -> { role, range, overview, breakdowns, daily }
//
// The function is authenticated and checks public.admin_users server-side --
// `role` in the response is the sole source of truth for access; the app
// never derives it from client-side state.
//
// The exact keys *inside* overview/breakdowns/daily were not specified when
// this was verified, so those are typed loosely (Record<string, unknown> /
// unknown[]) and the UI renders them defensively rather than assuming named
// fields like "totalVisitors" that may not exist.

export type AdminRole = "super_admin" | "admin" | "analyst";

export interface AdminAnalyticsRange {
  from?: string;
  to?: string;
  days?: number;
}

// Flat map of metric name -> number, shape not yet confirmed beyond that.
export type AdminAnalyticsOverview = Record<string, unknown>;

// Map of breakdown name (e.g. "country", "device") -> its rows, shape not
// yet confirmed beyond "some kind of list per breakdown".
export type AdminAnalyticsBreakdowns = Record<string, unknown>;

export interface AdminAnalyticsResponse {
  role: AdminRole | null;
  range?: AdminAnalyticsRange;
  overview?: AdminAnalyticsOverview;
  breakdowns?: AdminAnalyticsBreakdowns;
  daily?: unknown[];
}

export interface DateRange {
  from: string; // ISO date (yyyy-mm-dd)
  to: string;
}

// --- Exports (CSV/PDF/email) ---
//
// No backend endpoint for this exists yet (see utils/admin/exportClient.ts)
// -- these types describe the UI's *intended* request/job shape for when one
// is deployed, not a confirmed contract. analytics_export_jobs exists as a
// table, but nothing here writes to it directly from the browser.

export type ExportFormat = "csv" | "pdf" | "email";

export type ExportJobStatus = "pending" | "processing" | "completed" | "failed";

export interface ExportJob {
  id: string;
  reportType: string;
  format: ExportFormat;
  status: ExportJobStatus;
  createdAt: string;
  downloadUrl?: string | null;
  emailTo?: string | null;
}

export interface CreateExportJobInput {
  reportType: string;
  format: ExportFormat;
  dateRange: DateRange;
  filters?: Record<string, unknown>;
  emailTo?: string;
}
