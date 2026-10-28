// Tells the signed-in browser whether its visits are administrator traffic, so it can
// refrain from sending analytics and from loading Microsoft Clarity.
//
// The answer comes only from the server: the verified session cookie identifies the user
// and the existing `admin-analytics` role probe (public.admin_users, checked server-side
// by the Edge Function) decides. Nothing the browser sends is read. This is a convenience
// for the browser; the authoritative exclusion of first-party analytics is on the server
// (supabase/functions/_shared/adminTraffic.ts), so a client that ignores or lies about
// this answer changes only its own recordings.
//
//   200 { excluded: true }    a verified administrator (any admin_users role)
//   200 { excluded: false }   a guest, or a signed-in non-administrator
//   503 { error }             the role check could not be completed (never guessed)

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getVerifiedClaims } from "@/utils/supabase/claims";
import { fetchAdminRole } from "@/utils/admin/invoke";
import { isAdminRole, isForbiddenError } from "@/utils/analytics/audienceCheck";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  try {
    const { claims } = await getVerifiedClaims();
    if (!claims) return NextResponse.json({ excluded: false }, NO_STORE);

    const supabase = createClient(await cookies());
    try {
      const role = await fetchAdminRole(supabase);
      return NextResponse.json({ excluded: isAdminRole(role) }, NO_STORE);
    } catch (err) {
      // 403 from admin-analytics is its answer for "signed in, not an administrator".
      if (isForbiddenError(err)) return NextResponse.json({ excluded: false }, NO_STORE);
      return NextResponse.json({ error: "unavailable" }, { status: 503, ...NO_STORE });
    }
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, ...NO_STORE });
  }
}
