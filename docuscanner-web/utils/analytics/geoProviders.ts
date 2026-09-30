// Location provider layer for analytics geography.
//
//   VercelGeoProvider  -- first-party baseline: Vercel's edge geolocation
//                         (country, region, city, postal code). Always used.
//   IPGeoProvider      -- OPTIONAL server-side IP lookup that can add what
//                         Vercel does not supply (district/county, and a
//                         neighborhood/suburb if the provider returns one).
//                         Never replaces a value Vercel already supplied.
//
// Both produce the one NormalizedGeo (utils/analytics/geo.ts). Enrichment is
// off unless configured with environment variables:
//
//   GEO_PROVIDER          "ip2location" (unset / "none" = Vercel only)
//   GEO_PROVIDER_API_KEY  the provider's API key (server-side secret)
//   GEO_PROVIDER_TIMEOUT_MS  optional, default 1200
//
// Privacy / data minimization: the visitor IP is used server-side for the
// lookup only. It is not stored, not logged, and not used as a cache key
// (cache keys are SHA-256 digests held in memory). Only the normalized
// place names are persisted. Coordinates are never stored. Every value is
// what the provider returned -- nothing is inferred from a coordinate or from
// another level, and placeholders like "-" become null.

import { createHash } from "node:crypto";
import type { NormalizedGeo, RequestGeo } from "./geo.ts";

export interface IPGeoProvider {
  readonly name: string;
  lookup(ip: string, signal: AbortSignal): Promise<Partial<NormalizedGeo> | null>;
}

export interface GeoProviderConfig {
  provider: "none" | "ip2location";
  apiKey: string;
  timeoutMs: number;
}

export function readGeoProviderConfig(env: Record<string, string | undefined> = process.env): GeoProviderConfig {
  const name = (env.GEO_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = (env.GEO_PROVIDER_API_KEY ?? "").trim();
  const timeout = Number(env.GEO_PROVIDER_TIMEOUT_MS ?? "");
  return {
    provider: name === "ip2location" && apiKey ? "ip2location" : "none",
    apiKey,
    timeoutMs: Number.isFinite(timeout) && timeout >= 100 && timeout <= 5000 ? timeout : 1200,
  };
}

// Providers mark "no data" with placeholders instead of null.
const PLACEHOLDER = /^(-|--|n\/a|na|none|null|unknown|undefined)$/i;
export function cleanPlace(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && !PLACEHOLDER.test(v) ? v.slice(0, max) : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

// IP2Location.io (https://api.ip2location.io/). Documented response fields
// used: country_code, country_name, region_name, city_name, zip_code,
// latitude, longitude, and -- on plans that include it -- district. Every
// field is optional; a plan that lacks `district` simply yields null.
export function createIp2LocationProvider(apiKey: string, fetchImpl: typeof fetch = fetch): IPGeoProvider {
  return {
    name: "ip2location",
    async lookup(ip, signal) {
      const url = new URL("https://api.ip2location.io/");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("ip", ip);
      url.searchParams.set("format", "json");
      const res = await fetchImpl(url, { signal, cache: "no-store" });
      if (!res.ok) throw new Error(`ip2location responded ${res.status}`); // status only: never the URL (it carries the key)
      const body = (await res.json()) as Record<string, unknown>;
      const countryCode = cleanPlace(body.country_code, 8)?.toUpperCase() ?? null;
      if (!countryCode) return null;
      return {
        countryCode,
        countryName: cleanPlace(body.country_name),
        region: cleanPlace(body.region_name, 120),
        city: cleanPlace(body.city_name),
        countyDistrictLga: cleanPlace(body.district),
        // IP2Location has no neighborhood/suburb field; it stays null unless a
        // provider that genuinely returns one is added.
        neighborhoodSuburb: cleanPlace(body.neighborhood ?? body.suburb),
        postalCode: cleanPlace(body.zip_code, 20),
        latitude: num(body.latitude),
        longitude: num(body.longitude),
      };
    },
  };
}

export function createIpProvider(config: GeoProviderConfig, fetchImpl?: typeof fetch): IPGeoProvider | null {
  return config.provider === "ip2location" ? createIp2LocationProvider(config.apiKey, fetchImpl) : null;
}

const sameName = (a: string, b: string) => a.normalize("NFKD").toLowerCase().trim() === b.normalize("NFKD").toLowerCase().trim();

// Fills levels Vercel did not supply. Rules:
//  * Vercel's values are never replaced.
//  * A provider that disagrees about the country is ignored entirely.
//  * County/district and neighborhood are only taken when the provider's city
//    agrees with Vercel's (or Vercel has none), so a stored path is never a
//    mix of two different places.
export function mergeGeo(base: NormalizedGeo, extra: Partial<NormalizedGeo> | null, providerName: string): NormalizedGeo {
  if (!extra?.countryCode) return base;
  if (!base.countryCode) {
    return { ...base, ...pick(extra), countryCode: extra.countryCode, source: providerName };
  }
  if (base.countryCode !== extra.countryCode) return base;

  const cityConflict = !!(base.city && extra.city && !sameName(base.city, extra.city));
  const filled: NormalizedGeo = { ...base };
  let changed = false;
  const fill = <K extends keyof NormalizedGeo>(key: K, value: NormalizedGeo[K] | undefined | null) => {
    if (filled[key] == null && value != null) {
      filled[key] = value as NormalizedGeo[K];
      changed = true;
    }
  };
  if (!cityConflict) {
    fill("region", extra.region);
    fill("city", extra.city);
    fill("postalCode", extra.postalCode);
    fill("countyDistrictLga", extra.countyDistrictLga);
    fill("neighborhoodSuburb", extra.neighborhoodSuburb);
  }
  if (changed) filled.source = `${base.source}+${providerName}`;
  return filled;
}

function pick(extra: Partial<NormalizedGeo>): Partial<NormalizedGeo> {
  return {
    region: extra.region ?? null,
    city: extra.city ?? null,
    countyDistrictLga: extra.countyDistrictLga ?? null,
    neighborhoodSuburb: extra.neighborhoodSuburb ?? null,
    postalCode: extra.postalCode ?? null,
  };
}

// --- Lookup with timeout + in-memory cache --------------------------------
const TTL_HIT_MS = 60 * 60 * 1000;
const TTL_MISS_MS = 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map<string, { value: Partial<NormalizedGeo> | null; expires: number }>();

const digest = (ip: string) => createHash("sha256").update(ip).digest("hex");

export function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (ip.includes(":")) return !/^(::1?$|f[cd]|fe[89ab])/i.test(ip); // IPv6: loopback, ULA, link-local
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

export async function lookupWithCache(provider: IPGeoProvider, ip: string, timeoutMs: number, now = Date.now()): Promise<Partial<NormalizedGeo> | null> {
  const key = `${provider.name}:${digest(ip)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let value: Partial<NormalizedGeo> | null = null;
  let ok = true;
  try {
    value = await provider.lookup(ip, controller.signal);
  } catch (err) {
    ok = false;
    // Deliberately no IP and no URL in the log line.
    console.error(`geo provider "${provider.name}" lookup failed:`, err instanceof Error ? err.name : "error");
  } finally {
    clearTimeout(timer);
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { value, expires: now + (ok && value ? TTL_HIT_MS : TTL_MISS_MS) });
  return value;
}

export function clearGeoCache() {
  cache.clear();
}

// Adds optional IP enrichment to the baseline resolved by resolveRequestGeo()
// (Vercel). Called AFTER the route's rate limit and body validation, so an
// abusive caller can't drive provider lookups. Never throws and never delays a
// request beyond the provider timeout; any failure leaves the Vercel result
// untouched.
export async function enrichRequestGeo(
  base: RequestGeo,
  config: GeoProviderConfig = readGeoProviderConfig(),
  provider: IPGeoProvider | null = createIpProvider(config),
): Promise<RequestGeo> {
  if (!provider || !base.clientIp || !isPublicIp(base.clientIp)) return base;
  const extra = await lookupWithCache(provider, base.clientIp, config.timeoutMs);
  return { ...mergeGeo(base, extra, provider.name), clientIp: base.clientIp };
}
