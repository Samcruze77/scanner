// Unit tests for the geographic-analytics fallback/normalization logic in
// utils/analytics/geo.ts (the module every analytics/heartbeat/ad-event
// Route Handler uses to turn Vercel's geolocation() output into the trusted
// geo object forwarded to Supabase). No network, no browser -- pure
// functions only.
//
// Covers: country detection (worldwide, not just one country), missing
// location data falling back to Unknown/null, the City+Region+Country ->
// Region+Country -> Country -> Unknown fallback chain, and multiple
// countries/region/city availability combinations.
//
// Run: node tests/analytics/geo.mjs

import assert from "node:assert/strict";
import { normalizeVercelGeo, normalizeCloudflareCountry, composeLocationLabel } from "../../utils/analytics/geo.ts";

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

console.log("1. Country detection works for arbitrary countries (not hard-coded)");
{
  for (const [country, region, city] of [
    ["US", "CA", "San Francisco"],
    ["GB", "ENG", "London"],
    ["NG", "LA", "Lagos"],
    ["JP", "13", "Tokyo"],
    ["BR", "SP", "São Paulo"],
    ["AU", "NSW", "Sydney"],
  ]) {
    const result = normalizeVercelGeo({ country, countryRegion: region, city });
    check(`${country} country code preserved`, result.countryCode === country, JSON.stringify(result));
    check(`${country} region preserved`, result.region === region);
    check(`${country} city preserved`, result.city === city);
    check(`${country} source is vercel`, result.source === "vercel");
  }
}

console.log("2. Missing location data gracefully becomes Unknown/null");
{
  const empty = normalizeVercelGeo({});
  check("empty geo -> null country", empty.countryCode === null);
  check("empty geo -> null region", empty.region === null);
  check("empty geo -> null city", empty.city === null);
  check("empty geo -> source unknown", empty.source === "unknown");

  const nullish = normalizeVercelGeo(null);
  check("null geo -> null country", nullish.countryCode === null);
  check("null geo -> source unknown", nullish.source === "unknown");

  const undef = normalizeVercelGeo(undefined);
  check("undefined geo -> null country", undef.countryCode === null);

  const noCountryCode = normalizeCloudflareCountry(null);
  check("null cloudflare country -> null", noCountryCode.countryCode === null);
  check("null cloudflare country -> source unknown", noCountryCode.source === "unknown");
}

console.log("3. Country-only (Cloudflare fallback) never fabricates region/city");
{
  const result = normalizeCloudflareCountry("de");
  check("country code uppercased", result.countryCode === "DE", JSON.stringify(result));
  check("no region fabricated", result.region === null);
  check("no city fabricated", result.city === null);
  check("no postal code fabricated", result.postalCode === null);
  check("source is cloudflare", result.source === "cloudflare");
}

console.log("4. Region/city availability varies independently (never blocks capture)");
{
  const countryOnly = normalizeVercelGeo({ country: "CA" });
  check("country-only: country present", countryOnly.countryCode === "CA");
  check("country-only: region null", countryOnly.region === null);
  check("country-only: city null", countryOnly.city === null);

  const countryAndRegion = normalizeVercelGeo({ country: "CA", countryRegion: "ON" });
  check("country+region: region present", countryAndRegion.region === "ON");
  check("country+region: city still null", countryAndRegion.city === null);

  const full = normalizeVercelGeo({ country: "CA", countryRegion: "ON", city: "Toronto", postalCode: "M5V" });
  check("full: all fields present", full.region === "ON" && full.city === "Toronto" && full.postalCode === "M5V");
}

console.log("5. City + Region + Country -> Region + Country -> Country -> Unknown fallback chain");
{
  check(
    "full chain",
    composeLocationLabel({ countryCode: "NG", region: "Lagos", city: "Ikeja" }) === "Ikeja, Lagos, NG",
  );
  check(
    "region + country only",
    composeLocationLabel({ countryCode: "NG", region: "Lagos", city: null }) === "Lagos, NG",
  );
  check(
    "country only",
    composeLocationLabel({ countryCode: "NG", region: null, city: null }) === "NG",
  );
  check(
    "unknown when no country",
    composeLocationLabel({ countryCode: null, region: null, city: null }) === "Unknown",
  );
  check(
    "city without region still composes",
    composeLocationLabel({ countryCode: "US", region: null, city: "Austin" }) === "Austin, US",
  );
}

console.log("6. City values are URL-decoded (Vercel encodes multi-word cities)");
{
  const result = normalizeVercelGeo({ country: "FR", city: "Aix%20en%20Provence" });
  check("decoded city", result.city === "Aix en Provence", result.city ?? "null");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
