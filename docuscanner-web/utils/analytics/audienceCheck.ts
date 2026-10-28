// Decision logic for the audience probe (app/api/analytics/audience/route.ts), kept free of
// Next.js imports so every outcome can be unit-tested.

import { isUuid } from "./adminAccount";

export interface AudienceDeps {
  // Verified claims for the request's session cookie (null for a guest or an invalid token).
  getClaims: () => Promise<{ claims: unknown | null }>;
  // Is this user id a row in public.admin_users (ANY row: active or deactivated)? Must throw when
  // that cannot be established.
  isAdminAccount: (userId: string) => Promise<boolean>;
}

export type AudienceAnswer =
  | { status: 200; body: { excluded: boolean } }
  | { status: 503; body: { error: "unavailable" } };

// The answer is only ever a yes/no about the CALLER. It never returns analytics, roles or ids, so a
// failure at any step can at worst make the browser treat the caller as undecided: the browser then
// keeps Microsoft Clarity OFF (only the browser can stop Clarity) while first-party events are
// decided on the server (which drops them if it cannot tell).
//   no verified session                  -> { excluded: false }  (a guest)
//   verified session, malformed identity -> 503, never a guess
//   account is a row in admin_users      -> { excluded: true }   (active OR deactivated)
//   account is not in admin_users        -> { excluded: false }  (an ordinary customer)
//   anything else (network, 5xx, timeout, malformed answer, thrown error) -> 503
export async function resolveAudience(deps: AudienceDeps): Promise<AudienceAnswer> {
  try {
    const { claims } = await deps.getClaims();
    if (!claims) return { status: 200, body: { excluded: false } };
    const sub = (claims as { sub?: unknown } | null)?.sub;
    if (!isUuid(sub)) return { status: 503, body: { error: "unavailable" } };
    const member = await deps.isAdminAccount(sub);
    if (typeof member !== "boolean") return { status: 503, body: { error: "unavailable" } };
    return { status: 200, body: { excluded: member } };
  } catch {
    return { status: 503, body: { error: "unavailable" } };
  }
}
