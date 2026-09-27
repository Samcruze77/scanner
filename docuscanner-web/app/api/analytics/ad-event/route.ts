// Trusted proxy in front of the Supabase `track-ad-event` Edge Function. See
// app/api/analytics/track/route.ts and utils/analytics/proxy.server.ts.
// (`ads-eligible`, the read path that picks which ad to show, is unchanged
// -- this only affects impression/click *recording* accuracy.)

import { NextResponse } from "next/server";
import { resolveRequestGeo } from "@/utils/analytics/geo";
import { readJsonBody, rateLimited, resolveUserId, callEdgeFunction } from "@/utils/analytics/proxy.server";

export const runtime = "nodejs";

const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;

export async function POST(request: Request) {
  try {
    const geo = resolveRequestGeo(request);
    const rateKey = geo.clientIp ?? "unknown";
    if (rateLimited(`ad-event:${rateKey}`, RATE_WINDOW_MS, MAX_REQUESTS_PER_WINDOW)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const userId = await resolveUserId();

    const result = await callEdgeFunction("track-ad-event", {
      campaign_id: body.campaign_id,
      creative_id: body.creative_id,
      event_type: body.event_type,
      path: body.path,
      session_id: body.session_id,
      user_id: userId,
      geo: {
        country_code: geo.countryCode,
        region: geo.region,
        city: geo.city,
        postal_code: geo.postalCode,
        source: geo.source,
      },
    });

    return NextResponse.json({ ok: result.ok }, { status: result.ok ? 202 : result.status });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
