// SERVER-ONLY. Is this account a row in public.admin_users? Any row counts, active or not: the
// exclusion policy is "every account represented in admin_users", the same as the Edge Functions
// (supabase/functions/_shared/adminTraffic.ts).
//
// Used by /api/analytics/audience. The user id comes from the verified session claims, never from
// the request. The read uses the project's secret key (server environment only, like
// utils/analytics/edgeCall.ts) against PostgREST for this single, exact-match, one-row query; the
// secret never reaches the browser, and no table access policy is added or loosened.
//
// Throws on ANYTHING that is not a clear yes or no (missing configuration, a malformed id, a timeout,
// a non-2xx answer, a malformed body): callers must treat a throw as "unknown", never as "not an
// administrator".

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export interface AdminAccountOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  key?: string;
  timeoutMs?: number;
}

export async function lookupAdminAccount(userId: unknown, options: AdminAccountOptions = {}): Promise<boolean> {
  if (!isUuid(userId)) throw new Error("malformed user id");
  const base = (options.url ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = options.key ?? process.env.SUPABASE_SECRET_KEY ?? "";
  if (!base || !key) throw new Error("admin lookup is not configured");

  const url = new URL(`${base}/rest/v1/admin_users`);
  url.searchParams.set("select", "user_id");
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("limit", "1");
  const res = await (options.fetchImpl ?? fetch)(url, {
    headers: { apikey: key, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 2500),
  });
  if (!res.ok) throw new Error(`admin lookup rejected (${res.status})`);
  const rows: unknown = await res.json();
  if (!Array.isArray(rows)) throw new Error("malformed admin lookup answer");
  if (rows.length === 0) return false; // confirmed: no such row
  const first = rows[0] as { user_id?: unknown } | null;
  if (rows.length === 1 && first && typeof first === "object" && first.user_id === userId) return true;
  throw new Error("malformed admin lookup answer");
}
