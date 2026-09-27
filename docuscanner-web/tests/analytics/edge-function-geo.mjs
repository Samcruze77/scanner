// Unit tests for supabase/functions/_shared/geo.ts's extractTrustedGeo --
// the trust boundary inside track-analytics/heartbeat/track-ad-event that
// decides whether to use the caller-supplied `geo` object (only ever
// present when the call is authenticated with the project's secret key --
// see each function's `auth: "secret"`) versus the Cloudflare-only country
// fallback. No Deno runtime needed: this module has no Deno-specific APIs
// beyond crypto.subtle, which Node also implements.
//
// Run: node tests/analytics/edge-function-geo.mjs

import assert from "node:assert/strict";
import { extractTrustedGeo, normalizeString } from "../../supabase/functions/_shared/geo.ts";

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

function fakeRequest(headers = {}) {
  const map = new Map(Object.entries(headers));
  return { headers: { get: (name) => map.get(name.toLowerCase()) ?? null } };
}

console.log("1. Trusted body.geo (from the Next.js proxy) is used when present");
{
  const req = fakeRequest({ "cf-ipcountry": "US" }); // even if a country header is ALSO present
  const geo = extractTrustedGeo(req, {
    geo: { country_code: "ng", region: "Lagos", city: "Ikeja", postal_code: "100001", source: "vercel" },
  });
  check("country from body.geo, not the header", geo.countryCode === "NG", JSON.stringify(geo));
  check("region from body.geo", geo.region === "Lagos");
  check("city from body.geo", geo.city === "Ikeja");
  check("postal code from body.geo", geo.postalCode === "100001");
  check("source vercel", geo.source === "vercel");
}

console.log("2. Falls back to cf-ipcountry (country only) when no trusted geo supplied");
{
  const req = fakeRequest({ "cf-ipcountry": "de" });
  const geo = extractTrustedGeo(req, {});
  check("country from cf-ipcountry", geo.countryCode === "DE", JSON.stringify(geo));
  check("no region fabricated", geo.region === null);
  check("no city fabricated", geo.city === null);
  check("source cloudflare", geo.source === "cloudflare");
}

console.log("3. Neither trusted geo nor cf-ipcountry -> fully unknown, never discarded");
{
  const req = fakeRequest({});
  const geo = extractTrustedGeo(req, {});
  check("country null", geo.countryCode === null);
  check("region null", geo.region === null);
  check("city null", geo.city === null);
  check("source unknown", geo.source === "unknown");
}

console.log("4. Malformed/partial body.geo doesn't throw and degrades gracefully");
{
  const req = fakeRequest({ "cf-ipcountry": "FR" });
  const geo1 = extractTrustedGeo(req, { geo: "not-an-object" });
  check("string geo falls back to cf-ipcountry", geo1.countryCode === "FR", JSON.stringify(geo1));

  const geo2 = extractTrustedGeo(req, { geo: { region: "Lagos" } }); // no country_code at all
  check("geo without country_code falls back to cf-ipcountry", geo2.countryCode === "FR", JSON.stringify(geo2));

  const geo3 = extractTrustedGeo(fakeRequest({}), { geo: null });
  check("null geo -> unknown", geo3.countryCode === null);
}

console.log("5. Works for arbitrary countries worldwide, not a hard-coded list");
{
  for (const code of ["US", "NG", "GB", "JP", "BR", "ZA", "IN", "AU", "EG", "MX"]) {
    const geo = extractTrustedGeo(fakeRequest({}), { geo: { country_code: code, source: "vercel" } });
    check(`${code} round-trips`, geo.countryCode === code);
  }
}

console.log("6. normalizeString trims, caps length, and rejects non-strings");
{
  check("trims", normalizeString("  hi  ") === "hi");
  check("empty -> null", normalizeString("   ") === null);
  check("caps length", normalizeString("x".repeat(300), 10) === "x".repeat(10));
  check("non-string -> null", normalizeString(42) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
