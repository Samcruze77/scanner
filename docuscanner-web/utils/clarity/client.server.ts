// Server-only Clarity Data Export API client. The token lives only in the
// CLARITY_API_TOKEN environment variable (Clarity project -> Settings -> Data
// Export -> Generate new API token) and is never sent to a browser, logged, or
// included in an error message.
//
// Clarity allows 10 requests per project per day, so every distinct request
// (days + dimensions) is cached for six hours in Next's persistent data cache,
// shared across serverless instances. A failed call is never cached.

import { unstable_cache } from "next/cache";
import { buildClarityUrl, normalizeClarityResponse, type ClarityRequest, type ClarityRow } from "./api";

export class ClarityError extends Error {
  constructor(
    public code: "not_configured" | "unauthorized" | "rate_limited" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

export function clarityConfigured(): boolean {
  return !!process.env.CLARITY_API_TOKEN?.trim();
}

async function fetchLive(numOfDays: number, dimensions: string): Promise<{ fetchedAt: string; rows: ClarityRow[] }> {
  const token = process.env.CLARITY_API_TOKEN?.trim();
  if (!token) throw new ClarityError("not_configured", "Microsoft Clarity reporting is not connected: CLARITY_API_TOKEN is not set.");
  const request = { numOfDays, dimensions: dimensions.split(",") } as ClarityRequest;
  let res: Response;
  try {
    res = await fetch(buildClarityUrl(request), {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new ClarityError("unavailable", "Couldn't reach the Clarity API.");
  }
  if (res.status === 401 || res.status === 403) throw new ClarityError("unauthorized", "Clarity rejected the API token (check it is current and belongs to this project).");
  if (res.status === 429) throw new ClarityError("rate_limited", "Clarity's daily API limit (10 requests per project) has been reached. Try again tomorrow.");
  if (!res.ok) throw new ClarityError("unavailable", `Clarity API returned status ${res.status}.`);
  const body = await res.json().catch(() => null);
  return { fetchedAt: new Date().toISOString(), rows: normalizeClarityResponse(body, request.dimensions) };
}

const cached = unstable_cache(fetchLive, ["clarity-live-insights"], { revalidate: 6 * 60 * 60, tags: ["clarity"] });

export function getClarityInsights(request: ClarityRequest) {
  return cached(request.numOfDays, request.dimensions.join(","));
}
