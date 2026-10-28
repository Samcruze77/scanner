// Decision logic for the audience probe (app/api/analytics/audience/route.ts), kept free of
// Next.js imports so every outcome can be unit-tested.

// Every role that can sign in to the admin area counts as an administrator.
const ADMIN_ROLES = ["super_admin", "admin", "analyst"];

export function isAdminRole(role: unknown): boolean {
  return typeof role === "string" && ADMIN_ROLES.includes(role);
}

// supabase-js reports a non-2xx Edge Function answer as an error whose `context` is the
// Response. 403 is admin-analytics' answer for a signed-in caller who is not an administrator.
export function isForbiddenError(err: unknown): boolean {
  const context = (err as { context?: { status?: unknown } } | null)?.context;
  return typeof context?.status === "number" && (context.status === 403 || context.status === 401);
}

export interface AudienceDeps {
  // Verified claims for the request's session cookie (null for a guest or an invalid token).
  getClaims: () => Promise<{ claims: unknown | null }>;
  // The caller's role according to the server-side admin_users check (throws when not an admin).
  fetchRole: () => Promise<unknown>;
}

export type AudienceAnswer =
  | { status: 200; body: { excluded: boolean } }
  | { status: 503; body: { error: "unavailable" } };

// The answer is only ever a yes/no about the CALLER. It never returns analytics, roles or ids, so a
// failure at any step can at worst make the browser treat the caller as an ordinary visitor (which
// changes only that browser's own recordings: first-party events are excluded again on the server).
//   no verified session            -> { excluded: false }   (a guest)
//   admin role from the server     -> { excluded: true }
//   403 / 401 from the role check  -> { excluded: false }   (signed in, not an administrator)
//   anything else (network, 5xx, a thrown error) -> 503, never a guess
export async function resolveAudience(deps: AudienceDeps): Promise<AudienceAnswer> {
  try {
    const { claims } = await deps.getClaims();
    if (!claims) return { status: 200, body: { excluded: false } };
    try {
      return { status: 200, body: { excluded: isAdminRole(await deps.fetchRole()) } };
    } catch (err) {
      if (isForbiddenError(err)) return { status: 200, body: { excluded: false } };
      return { status: 503, body: { error: "unavailable" } };
    }
  } catch {
    return { status: 503, body: { error: "unavailable" } };
  }
}
