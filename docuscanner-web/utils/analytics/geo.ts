// Server-only geographic normalization, shared by every Route Handler that
// proxies an analytics/presence/ad write to its Supabase Edge Function (see
// app/api/analytics/*/route.ts). Country is captured whenever the platform
// provides it; region/city/postal code are captured best-effort and never
// block or replace a coarser fallback.
//
// Source of truth: Vercel's own edge geolocation (`@vercel/functions`),
// populated because every request to this Next.js app is proxied by Vercel
// -- NOT the `x-vercel-ip-*` headers read directly by a Supabase Edge
// Function, which never see Vercel's proxy (Supabase's own gateway forwards
// only `cf-ipcountry`/`cf-connecting-ip`, country-only). Routing analytics
// writes through this app first is what makes region/city available at all;
// see the milestone report for the full investigation.
//
// No browser geolocation (GPS) is ever involved. No raw IP address is ever
// forwarded downstream unhashed for storage -- see hashClientIp below.

import { geolocation, ipAddress, type Geo } from "@vercel/functions";

export type LocationSource = "vercel" | "cloudflare" | "unknown" | (string & {});

export interface NormalizedGeo {
  countryCode: string | null;
  region: string | null;
  city: string | null;
  // Not supplied by Vercel's geolocation -- always null with the current
  // provider, carried so a provider that has them can populate them without
  // another schema/API change.
  countyDistrictLga: string | null;
  neighborhoodSuburb: string | null;
  postalCode: string | null;
  // Where the values came from: "vercel", "cloudflare", "unknown", or
  // "vercel+<provider>" when an IP provider filled in missing levels.
  source: LocationSource;
  // Transient provider extras -- carried for consistency checks only, NEVER
  // stored (analytics keeps just the normalized hierarchy above).
  countryName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

const UNKNOWN_GEO: NormalizedGeo = {
  countryCode: null,
  region: null,
  city: null,
  countyDistrictLga: null,
  neighborhoodSuburb: null,
  postalCode: null,
  source: "unknown",
};

function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// Vercel percent-encodes the city header. A malformed sequence must cost only the
// city, never the whole event (decodeURIComponent throws on it).
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function cleanCountryCode(value: string | null | undefined): string | null {
  const v = clean(value, 8);
  return v ? v.toUpperCase() : null;
}

// Vercel's `geolocation()` returns `{}` (no throw) when the request never
// passed through Vercel's proxy -- e.g. local dev -- so an all-empty object
// is treated the same as "not available", not a country of "undefined".
export function normalizeVercelGeo(geo: Geo | null | undefined): NormalizedGeo {
  const countryCode = cleanCountryCode(geo?.country);
  if (!countryCode) return UNKNOWN_GEO;
  return {
    countryCode,
    region: clean(geo?.countryRegion, 120),
    city: clean(geo?.city ? safeDecode(geo.city) : null, 160),
    countyDistrictLga: null,
    neighborhoodSuburb: null,
    postalCode: clean(geo?.postalCode, 20),
    source: "vercel",
  };
}

// Fallback used only when a caller has nothing but a bare country code
// (e.g. a legacy/direct Cloudflare-fronted path). Region/city are never
// fabricated here.
export function normalizeCloudflareCountry(countryCode: string | null | undefined): NormalizedGeo {
  const code = cleanCountryCode(countryCode);
  if (!code) return UNKNOWN_GEO;
  return { ...UNKNOWN_GEO, countryCode: code, source: "cloudflare" };
}

// City + Region + Country -> Region + Country -> Country -> Unknown. Used
// wherever a single human-readable location string is needed (logs,
// fallback display) without duplicating the admin UI's flag/name rendering.
export function composeLocationLabel(geo: Pick<NormalizedGeo, "countryCode" | "region" | "city">): string {
  const { countryCode, region, city } = geo;
  if (!countryCode) return "Unknown";
  const parts = [city, region, countryCode].filter((p): p is string => !!p);
  return parts.join(", ");
}

export interface RequestGeo extends NormalizedGeo {
  clientIp: string | null;
}

// Single entry point for a Route Handler: resolves both the visitor's real
// IP (for hashing/rate-limiting downstream, never stored raw) and their
// best-available location in one call.
export function resolveRequestGeo(request: Request): RequestGeo {
  const geo = normalizeVercelGeo(geolocation(request));
  const clientIp = ipAddress(request) ?? null;
  return { ...geo, clientIp };
}
