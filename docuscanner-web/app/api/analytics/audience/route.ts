// Tells the signed-in browser whether its visits are administrator traffic, so it can
// refrain from sending analytics and from loading Microsoft Clarity.
//
// The answer comes only from the server: the verified session cookie identifies the user
// and the existing `admin-analytics` role probe (public.admin_users, checked server-side
// by the Edge Function) decides. This handler takes NO input from the request (no body,
// query string or header is read), so nothing the browser sends can influence it. It is a
// convenience for the browser; the authoritative exclusion of first-party analytics is on
// the server (supabase/functions/_shared/adminTraffic.ts), so a client that ignores or lies
// about this answer changes only its own recordings. See utils/analytics/audienceCheck.ts
// for the outcomes:
//
//   200 { excluded: true }    a verified administrator (any admin_users role)
//   200 { excluded: false }   a guest, or a signed-in non-administrator
//   503 { error }             the role check could not be completed (never guessed)

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getVerifiedClaims } from "@/utils/supabase/claims";
import { fetchAdminRole } from "@/utils/admin/invoke";
import { resolveAudience } from "@/utils/analytics/audienceCheck";

export const runtime = "nodejs";

export async function GET() {
  const answer = await resolveAudience({
    getClaims: getVerifiedClaims,
    fetchRole: async () => fetchAdminRole(createClient(await cookies())),
  });
  return NextResponse.json(answer.body, { status: answer.status, headers: { "Cache-Control": "no-store" } });
}
