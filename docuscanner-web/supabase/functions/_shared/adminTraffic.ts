// Administrator traffic is excluded from visitor analytics at the server.
//
// "Administrator" means a row in public.admin_users (any role: super_admin, admin,
// analyst), the same table every admin Edge Function already authorizes against.
// Nothing here reads a flag from the browser: ingestion is told the user id by the
// secret-key-authenticated Next.js proxy (which takes it from the verified session
// cookie), and reporting reads the table itself.
//
// Three ways traffic is attributed to an administrator (the SQL in migration
// 20261028134500 applies exactly the same three rules):
//   - user_id: the event/session carries an administrator's account id.
//   - visitor_id: the same browser (anonymous visitor_id) ALSO produced events while
//     an administrator was signed in. Events from that browser before sign-in (the
//     administrator's own pre-login testing) are excluded too. A browser that never
//     recorded a signed-in administrator cannot be linked, so those rows stay.
//   - session_id: the session in which an administrator was signed in (the only link
//     available for ad events, which carry a session id but no visitor id).
//
// Nothing is deleted or rewritten: historical rows stay in the tables and are only
// left out of visitor reports. Audit logs (admin_audit_logs) are not touched.

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

const PAGE_SIZE = 1000;
const MAX_PAGES = 100; // 100k rows of administrator activity per table

// Every administrator account, active or not: a former administrator's testing is
// still administrator traffic.
export async function loadAdminTraffic(admin: AdminClient): Promise<AdminTraffic> {
  const { data: admins, error } = await admin.from("admin_users").select("user_id");
  if (error || !Array.isArray(admins) || admins.length === 0) return { userIds: new Set(), visitorIds: new Set(), sessionIds: new Set() };
  const userIds: string[] = admins.map((a: { user_id: string }) => a.user_id);
  const visitorIds = new Set<string>();
  const sessionIds = new Set<string>();
  // Paged (PostgREST returns at most 1000 rows per request) in a stable order, so the link set is
  // complete however many events an administrator has produced.
  for (const [table, orderBy] of [["analytics_events", "id"], ["live_sessions", "session_id"]] as const) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error: pageError } = await admin
        .from(table)
        .select("visitor_id,session_id")
        .in("user_id", userIds)
        .order(orderBy, { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (pageError) break;
      for (const r of (data ?? []) as { visitor_id: string | null; session_id: string | null }[]) {
        if (r.visitor_id) visitorIds.add(r.visitor_id);
        if (r.session_id) sessionIds.add(r.session_id);
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return { userIds: new Set(userIds), visitorIds, sessionIds };
}

// Ingestion-side check, cached briefly per Edge Function instance so a signed-in
// visitor's events do not each cost a database read. A role change therefore takes
// effect within CACHE_MS. Only signed-in callers are ever looked up (guests have no
// user id). On a lookup failure the event is recorded rather than lost.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; admin: boolean }>();

export async function isAdminUser(admin: AdminClient, userId: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!userId) return false;
  const hit = cache.get(userId);
  if (hit && now - hit.at < CACHE_MS) return hit.admin;
  const { data, error } = await admin.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) return false;
  const admin_ = !!data;
  cache.set(userId, { at: now, admin: admin_ });
  if (cache.size > 5000) {
    for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
  }
  return admin_;
}

export function clearAdminCache() {
  cache.clear();
}
