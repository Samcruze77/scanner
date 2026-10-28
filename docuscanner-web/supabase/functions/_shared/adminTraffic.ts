// Administrator traffic is excluded from visitor analytics at the server.
//
// "Administrator" means ANY row in public.admin_users (super_admin, admin, analyst; active or
// deactivated), the same table every admin Edge Function authorizes against. Nothing here reads a
// flag from the browser: ingestion is told the user id by the secret-key-authenticated Next.js proxy
// (which takes it from the verified session cookie), and reporting reads the table itself.
//
// Three ways traffic is attributed to an administrator (the SQL in migration
// 20261028141446 applies exactly the same three rules):
//   - user_id: the event/session carries an administrator's account id.
//   - visitor_id: the same browser (anonymous visitor_id) ALSO produced events while an
//     administrator was signed in. Events from that browser before sign-in (the administrator's own
//     pre-login testing) are excluded too. A browser that never recorded a signed-in administrator
//     cannot be linked, so those rows stay.
//   - session_id: the session in which an administrator was signed in (the only link available for
//     ad events, which carry a session id but no visitor id).
//
// Nothing is deleted or rewritten: historical rows stay in the tables and are only left out of
// visitor reports. Audit logs (admin_audit_logs) are not touched.
//
// FAILURE POLICY (an exclusion decision that cannot be established is never treated as "not an
// administrator"):
//   ingestion  -> checkAdminUser() answers "admin" | "not_admin" | "unknown". Guests (no user id) need
//                 no lookup and are always tracked. For a signed-in caller the answer comes from a fresh
//                 cache entry, else the database (bounded by a timeout). If the lookup fails, a
//                 previously VERIFIED answer for the same user up to STALE_MS old is reused; otherwise the
//                 answer is "unknown" and the caller DROPS the event (HTTP 503, an operational error is
//                 logged without any event content). Trade-off: while the lookup is down, events from
//                 signed-in visitors are dropped; guests are unaffected.
//   reporting  -> loadAdminTraffic() throws AdminTrafficUnavailable when it cannot read the
//                 administrator accounts or their browsers/sessions completely, and the report endpoints
//                 answer 503 instead of publishing figures that still include administrators.

export interface AdminTraffic {
  userIds: Set<string>;
  visitorIds: Set<string>;
  sessionIds: Set<string>;
}

export const EMPTY_ADMIN_TRAFFIC: AdminTraffic = { userIds: new Set(), visitorIds: new Set(), sessionIds: new Set() };

export function isAdminTraffic(
  traffic: AdminTraffic,
  row: { user_id?: string | null; visitor_id?: string | null; session_id?: string | null },
): boolean {
  if (row.user_id && traffic.userIds.has(row.user_id)) return true;
  if (row.visitor_id && traffic.visitorIds.has(row.visitor_id)) return true;
  if (row.session_id && traffic.sessionIds.has(row.session_id)) return true;
  return false;
}

// Structural type so this file does not depend on a particular supabase-js version.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = { from: (table: string) => any };

export class AdminTrafficUnavailable extends Error {
  constructor(reason: string) {
    super(`administrator exclusion unavailable: ${reason}`);
    this.name = "AdminTrafficUnavailable";
  }
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 100; // 100k rows of administrator activity per table

// Every administrator account, active or not, plus the browsers and sessions they signed in from.
// Throws AdminTrafficUnavailable on any read failure, a malformed answer, or a result too large to
// read completely: a partial answer would silently let administrator traffic through.
export async function loadAdminTraffic(admin: AdminClient): Promise<AdminTraffic> {
  const accounts = await admin.from("admin_users").select("user_id");
  if (!accounts || accounts.error || !Array.isArray(accounts.data)) throw new AdminTrafficUnavailable("administrator accounts unreadable");
  if (accounts.data.some((a: unknown) => !a || typeof (a as { user_id?: unknown }).user_id !== "string")) throw new AdminTrafficUnavailable("administrator accounts malformed");
  const userIds: string[] = accounts.data.map((a: { user_id: string }) => a.user_id);
  if (userIds.length === 0) return { userIds: new Set(), visitorIds: new Set(), sessionIds: new Set() };

  const visitorIds = new Set<string>();
  const sessionIds = new Set<string>();
  // Paged (PostgREST returns at most 1000 rows per request) in a stable order.
  for (const [table, orderBy] of [["analytics_events", "id"], ["live_sessions", "session_id"]] as const) {
    let complete = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await admin
        .from(table)
        .select("visitor_id,session_id")
        .in("user_id", userIds)
        .order(orderBy, { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!res || res.error || !Array.isArray(res.data)) throw new AdminTrafficUnavailable(`${table} link lookup failed`);
      for (const r of res.data as { visitor_id: string | null; session_id: string | null }[]) {
        if (r?.visitor_id) visitorIds.add(r.visitor_id);
        if (r?.session_id) sessionIds.add(r.session_id);
      }
      if (res.data.length < PAGE_SIZE) {
        complete = true;
        break;
      }
    }
    if (!complete) throw new AdminTrafficUnavailable(`${table} link lookup incomplete`);
  }
  return { userIds: new Set(userIds), visitorIds, sessionIds };
}

// ---- ingestion check -----------------------------------------------------------------------------------------------

export type AdminCheck = "admin" | "not_admin" | "unknown";

export const CHECK_CACHE_MS = 60_000; // a verified answer is reused this long without asking again
export const STALE_MS = 10 * 60_000; // ...and, only if the database cannot be reached, this long
export const CHECK_TIMEOUT_MS = 2_500;
const LOG_EVERY_MS = 30_000;

const cache = new Map<string, { at: number; admin: boolean }>();
let lastLogAt = 0;

export function clearAdminCache() {
  cache.clear();
  lastLogAt = 0;
}

function logLookupFailure(reason: string, now: number) {
  if (now - lastLogAt < LOG_EVERY_MS) return;
  lastLogAt = now;
  // Operational signal only: no user id, event body, headers or IP.
  console.error(`admin exclusion lookup failed (${reason}); events from signed-in visitors are not recorded until it recovers`);
}

type Lookup = { ok: true; admin: boolean } | { ok: false; reason: string };

async function lookup(admin: AdminClient, userId: string, timeoutMs: number): Promise<Lookup> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = Promise.resolve(admin.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle());
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const res = await Promise.race([query, timeout]);
    if (res === "timeout") return { ok: false, reason: "timeout" };
    if (!res || typeof res !== "object") return { ok: false, reason: "malformed response" };
    const { data, error } = res as { data?: unknown; error?: unknown };
    if (error) return { ok: false, reason: "query rejected" };
    if (data === null) return { ok: true, admin: false }; // confirmed: no such row
    if (data && typeof data === "object" && (data as { user_id?: unknown }).user_id === userId) return { ok: true, admin: true };
    return { ok: false, reason: "malformed response" }; // undefined, or a row for someone else
  } catch {
    return { ok: false, reason: "exception" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Is this signed-in caller an administrator? "unknown" means it could not be established and the
// caller must not record the event.
export async function checkAdminUser(
  admin: AdminClient,
  userId: string | null | undefined,
  opts: { now?: number; timeoutMs?: number } = {},
): Promise<AdminCheck> {
  if (!userId) return "not_admin"; // a guest: there is no account to look up
  const now = opts.now ?? Date.now();
  const hit = cache.get(userId);
  if (hit && now - hit.at < CHECK_CACHE_MS) return hit.admin ? "admin" : "not_admin";

  const result = await lookup(admin, userId, opts.timeoutMs ?? CHECK_TIMEOUT_MS);
  if (result.ok) {
    cache.set(userId, { at: now, admin: result.admin });
    if (cache.size > 5000) {
      for (const [k, v] of cache) if (now - v.at >= STALE_MS) cache.delete(k);
    }
    return result.admin ? "admin" : "not_admin";
  }
  logLookupFailure(result.reason, now);
  // Lookup failed: a verified answer that is still within the grace window is the best evidence we have.
  if (hit && now - hit.at < STALE_MS) return hit.admin ? "admin" : "not_admin";
  return "unknown";
}
