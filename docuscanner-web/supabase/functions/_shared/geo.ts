// Shared by track-analytics, heartbeat, and track-ad-event: user-agent
// parsing, string normalization, and trusted-geo extraction. All three are
// now called ONLY by this app's own Next.js Route Handlers (see
// docuscanner-web/utils/analytics/proxy.server.ts), authenticated with the
// project's secret key, which is what makes the caller-supplied `geo` object
// on the body trustworthy -- a request that reaches this function without
// that key never gets here at all (see each function's `auth: 'secret'`).
//
// The `cf-ipcountry` fallback below exists only as defense-in-depth for the
// rare case a trusted caller has no geo (e.g. local dev, or Vercel's proxy
// genuinely has no signal) -- it is never treated as more reliable than an
// explicit `geo` object.

export function normalizeString(value: unknown, max = 200): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function normalizeCountryCode(value: unknown): string | null {
  const v = normalizeString(value, 8);
  return v ? v.toUpperCase() : null;
}

export interface TrustedGeo {
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  source: "vercel" | "cloudflare" | "unknown";
}

const UNKNOWN_GEO: TrustedGeo = { countryCode: null, region: null, city: null, postalCode: null, source: "unknown" };

// `body.geo` is the object the Next.js proxy computed from Vercel's real
// geolocation headers. Falls back to Cloudflare's country-only header
// (set by Supabase's own gateway, not forgeable by a caller) only when the
// trusted caller didn't supply one at all.
export function extractTrustedGeo(req: Request, body: Record<string, unknown>): TrustedGeo {
  const geo = body.geo && typeof body.geo === "object" ? (body.geo as Record<string, unknown>) : null;
  const countryCode = normalizeCountryCode(geo?.country_code);
  if (countryCode) {
    const source = geo?.source === "vercel" || geo?.source === "cloudflare" ? geo.source : "vercel";
    return {
      countryCode,
      region: normalizeString(geo?.region, 120),
      city: normalizeString(geo?.city, 160),
      postalCode: normalizeString(geo?.postal_code, 20),
      source,
    };
  }

  const cfCountry = normalizeCountryCode(req.headers.get("cf-ipcountry"));
  if (cfCountry) return { ...UNKNOWN_GEO, countryCode: cfCountry, source: "cloudflare" };

  return UNKNOWN_GEO;
}

export function deviceFromUserAgent(ua: string): "desktop" | "tablet" | "mobile" {
  const value = ua.toLowerCase();
  if (/ipad|tablet|kindle|silk/.test(value)) return "tablet";
  if (/mobile|iphone|android/.test(value)) return "mobile";
  return "desktop";
}

export function browserFromUserAgent(ua: string): string {
  const value = ua.toLowerCase();
  if (value.includes("edg/")) return "edge";
  if (value.includes("opr/") || value.includes("opera")) return "opera";
  if (value.includes("chrome/")) return "chrome";
  if (value.includes("firefox/")) return "firefox";
  if (value.includes("safari/") && !value.includes("chrome/")) return "safari";
  return "other";
}

export function osFromUserAgent(ua: string): string {
  const value = ua.toLowerCase();
  if (value.includes("windows")) return "windows";
  if (value.includes("mac os") || value.includes("macintosh")) return "macos";
  if (value.includes("iphone") || value.includes("ipad")) return "ios";
  if (value.includes("android")) return "android";
  if (value.includes("linux")) return "linux";
  return "other";
}

export async function hmacIp(ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
