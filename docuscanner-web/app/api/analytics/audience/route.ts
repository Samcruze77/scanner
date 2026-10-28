// Tells the signed-in browser whether its visits are administrator traffic, so it can
// refrain from sending analytics and from loading Microsoft Clarity.
//
// The answer comes only from the server: the verified session cookie identifies the user, and
// membership of public.admin_users (ANY row, active or deactivated -- the same policy the Edge
// Functions use to exclude administrators) decides. This handler takes NO input from the request (no
// body, query string or header is read), so nothing the browser sends can influence it. It is a
// convenience for the browser; the authoritative exclusion of first-party analytics is on the
// server (supabase/functions/_shared/adminTraffic.ts). See utils/analytics/audienceCheck.ts:
//
//   200 { excluded: true }    the account is in admin_users (any role, active or not)
//   200 { excluded: false }   a guest, or a signed-in account that is not in admin_users
//   503 { error }             the check could not be completed (never guessed): the browser keeps
//                             Microsoft Clarity off

import { NextResponse } from "next/server";
import { getVerifiedClaims } from "@/utils/supabase/claims";
import { lookupAdminAccount } from "@/utils/analytics/adminAccount";
import { resolveAudience } from "@/utils/analytics/audienceCheck";

export const runtime = "nodejs";

export async function GET() {
  const answer = await resolveAudience({
    getClaims: getVerifiedClaims,
    isAdminAccount: (userId) => lookupAdminAccount(userId),
  });
  return NextResponse.json(answer.body, { status: answer.status, headers: { "Cache-Control": "no-store" } });
}
