// Trusted proxy in front of the Supabase `track-analytics` Edge Function.
// See utils/analytics/proxy.server.ts for why this exists: it's the only
// place in the request path where Vercel's real geolocation headers are
// available, and the only caller the Edge Function now accepts.

import { NextResponse } from "next/server";
import { resolveRequestGeo } from "@/utils/analytics/geo";
import { readJsonBody, rateLimited, resolveUserId, callEdgeFunction } from "@/utils/analytics/proxy.server";

export const runtime = "nodejs";

const RATE_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 30;

export async function POST(request: Request) {
  try {
    const geo = resolveRequestGeo(request);
    const rateKey = geo.clientIp ?? "unknown";
    if (rateLimited(`track:${rateKey}`, RATE_WINDOW_MS, MAX_EVENTS_PER_WINDOW)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const userId = await resolveUserId();

    const result = await callEdgeFunction("track-analytics", {
      event_name: body.event_name,
      visitor_id: body.visitor_id,
      session_id: body.session_id,
      path: body.path,
      referrer: body.referrer,
      properties: body.properties,
      user_id: userId,
      client_ip: geo.clientIp,
      geo: {
        country_code: geo.countryCode,
        region: geo.region,
        city: geo.city,
        county_district_lga: geo.countyDistrictLga,
        neighborhood_suburb: geo.neighborhoodSuburb,
        postal_code: geo.postalCode,
        source: geo.source,
      },
    });

    return NextResponse.json({ ok: result.ok }, { status: result.ok ? 202 : result.status });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
