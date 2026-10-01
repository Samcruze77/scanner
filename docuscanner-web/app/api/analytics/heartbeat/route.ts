// Trusted proxy in front of the Supabase `heartbeat` Edge Function. See
// app/api/analytics/track/route.ts and utils/analytics/proxy.server.ts.

import { NextResponse } from "next/server";
import { resolveRequestGeo } from "@/utils/analytics/geo";
import { enrichRequestGeo } from "@/utils/analytics/geoProviders";
import { readJsonBody, rateLimited, resolveUserId, callEdgeFunction } from "@/utils/analytics/proxy.server";

export const runtime = "nodejs";

const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

export async function POST(request: Request) {
  try {
    const baseGeo = resolveRequestGeo(request);
    const rateKey = baseGeo.clientIp ?? "unknown";
    if (rateLimited(`heartbeat:${rateKey}`, RATE_WINDOW_MS, MAX_REQUESTS_PER_WINDOW)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const [userId, geo] = await Promise.all([resolveUserId(), enrichRequestGeo(baseGeo)]);
    // Optional IP enrichment (off unless GEO_PROVIDER is configured).

    const result = await callEdgeFunction("heartbeat", {
      session_id: body.session_id,
      visitor_id: body.visitor_id,
      path: body.path,
      tool: body.tool,
      activity: body.activity,
      user_id: userId,
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
