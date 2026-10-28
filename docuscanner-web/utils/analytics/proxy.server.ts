// Shared server-only helpers for the app/api/analytics/* Route Handlers.
// Each of those routes is a thin, trusted proxy in front of a Supabase Edge
// Function: it runs on Vercel (so Vercel's geolocation headers are real),
// resolves the caller's identity from the already-established SSR session
// cookie, then calls the Edge Function server-to-server using the project's
// secret key (see supabase-server skill: "Server-to-server (secret key
// auth)"). The Edge Function trusts the geo/user_id this proxy supplies
// *because* the call is authenticated with the secret key -- a request that
// reaches Supabase directly, without that key, is rejected outright, so a
// client can no longer forge its own country/region/city by hand-crafting
// headers (the previous direct-to-Supabase path could).

import { cookies } from "next/headers";
import { createClient as createServerSupabaseClient } from "@/utils/supabase/server";


export const MAX_BODY_BYTES = 8 * 1024;

// Best-effort per-instance rate limiter, same warm-instance-bucket technique
// already used by the Edge Functions it replaces. A serverless instance is
// ephemeral and there are many of them, so this is a courtesy speed bump,
// not a hard guarantee -- consistent with the existing risk profile.
const buckets = new Map<string, { startedAt: number; count: number }>();

export function rateLimited(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  if (buckets.size > 20_000) {
    for (const [k, v] of buckets) {
      if (now - v.startedAt >= windowMs) buckets.delete(k);
    }
  }
  return bucket.count > max;
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return null;
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Resolves the signed-in user id (if any) from the request's own SSR
// session cookie -- the same cookie proxy.ts keeps fresh -- so callers never
// need to manually attach or forward a bearer token for this.
export async function resolveUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    // getClaims() verifies the token locally when the project uses asymmetric
    // signing keys; getUser() was a network round trip to Supabase Auth on
    // every analytics request from a signed-in visitor. Guests have no
    // session cookie, so neither call does any work for them.
    const { data } = await supabase.auth.getClaims();
    return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  } catch {
    return null;
  }
}

// The server-to-server Edge Function call lives in ./edgeCall (no Next.js imports, so it is unit-testable).
export { callEdgeFunction, visitorUserAgent, type EdgeFunctionCallResult } from "./edgeCall";
