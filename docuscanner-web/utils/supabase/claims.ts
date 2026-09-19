import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

/**
 * The authorization primitive for Server Components and Route Handlers.
 *
 * Do NOT use `supabase.auth.getSession()` for authorization -- it only reads
 * the session out of cookies without verifying it, so a tampered cookie would
 * be trusted. `getClaims()` verifies the access token's signature (locally
 * against the Supabase project's JWKS for asymmetric keys, otherwise against
 * the Auth server) and returns the verified claims, which is what any check
 * that gates a save/history/account action should use.
 *
 * Returns `{ claims: null }` for guests -- callers should treat that as "no
 * account-only features available," never redirect away from core scanning.
 */
export async function getVerifiedClaims() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    return { claims: null, error };
  }

  return { claims: data.claims, error: null };
}
