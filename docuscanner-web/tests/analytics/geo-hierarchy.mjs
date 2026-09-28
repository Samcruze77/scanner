// Unit tests for the Country -> State/Region -> City admin geography
// rework: the pure aggregation module (supabase/functions/_shared/
// geoHierarchy.ts, shared with the deployed admin-analytics Edge Function)
// and the display-formatting module (utils/admin/location.ts). No network,
// no browser, no Deno -- pure functions only.
//
// Run: node tests/analytics/geo-hierarchy.mjs

import assert from "node:assert/strict";
import {
  UNKNOWN,
  buildGeoHierarchy,
  buildLocationRows,
} from "../../supabase/functions/_shared/geoHierarchy.ts";
import { countryName, regionName, formatFullLocation } from "../../utils/admin/location.ts";

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

function ev(overrides = {}) {
  return {
    event_name: "page_view",
    visitor_id: "v1",
    session_id: "s1",
    user_id: null,
    country_code: null,
    region: null,
    city: null,
    device_type: "desktop",
    created_at: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

function ad(overrides = {}) {
  return {
    event_type: "impression",
    country_code: null,
    region: null,
    city: null,
    device_type: "desktop",
    created_at: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

console.log("1. Country grouping works (worldwide, not a hard-coded list)");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "NG", region: "LA", city: "Lagos" }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "US", region: "CA", city: "Los Angeles" }),
    ev({ visitor_id: "u3", session_id: "s3", country_code: "GB", region: "ENG", city: "London" }),
    ev({ visitor_id: "u4", session_id: "s4", country_code: "JP", region: "13", city: "Tokyo" }),
    ev({ visitor_id: "u5", session_id: "s5", country_code: "BR", region: "SP", city: "São Paulo" }),
  ];
  const { countries } = buildGeoHierarchy(rows, [], 5, 5);
  const keys = countries.map((c) => c.key).sort();
  check("all 5 arbitrary countries present", JSON.stringify(keys) === JSON.stringify(["BR", "GB", "JP", "NG", "US"].sort()), JSON.stringify(keys));
  check("each country has exactly 1 user", countries.every((c) => c.users === 1));
}

console.log("2. Region grouping works, scoped per country");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "NG", region: "LA", city: "Lagos" }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "NG", region: "OY", city: "Ibadan" }),
    ev({ visitor_id: "u3", session_id: "s3", country_code: "NG", region: "LA", city: "Ikeja" }),
    ev({ visitor_id: "u4", session_id: "s4", country_code: "US", region: "CA", city: "Los Angeles" }),
  ];
  const { regionsByCountry } = buildGeoHierarchy(rows, [], 4, 4);
  const ngRegions = regionsByCountry.NG.map((r) => r.key).sort();
  check("Nigeria has LA and OY regions", JSON.stringify(ngRegions) === JSON.stringify(["LA", "OY"]), JSON.stringify(ngRegions));
  check("Nigeria LA region has 2 users (Lagos + Ikeja)", regionsByCountry.NG.find((r) => r.key === "LA").users === 2);
  check("US regions never leak into NG's list", !ngRegions.includes("CA"));
  check("US has its own CA region", regionsByCountry.US.map((r) => r.key).includes("CA"));
}

console.log("3. City grouping works, scoped per country (and carries its region)");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "NG", region: "LA", city: "Lagos" }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "NG", region: "LA", city: "Ikeja" }),
    ev({ visitor_id: "u3", session_id: "s3", country_code: "NG", region: "OY", city: "Ibadan" }),
  ];
  const { citiesByCountry } = buildGeoHierarchy(rows, [], 3, 3);
  const ngCities = citiesByCountry.NG.map((c) => c.key).sort();
  check("Nigeria has all 3 cities", JSON.stringify(ngCities) === JSON.stringify(["Ibadan", "Ikeja", "Lagos"]), JSON.stringify(ngCities));
  const lagos = citiesByCountry.NG.find((c) => c.key === "Lagos");
  check("Lagos city row carries its region (LA)", lagos.region === "LA");
  const ibadan = citiesByCountry.NG.find((c) => c.key === "Ibadan");
  check("Ibadan city row carries its own region (OY), not Lagos's", ibadan.region === "OY");
}

console.log("4. Country row's regions/cities counts roll up correctly");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "NG", region: "LA", city: "Lagos" }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "NG", region: "LA", city: "Ikeja" }),
    ev({ visitor_id: "u3", session_id: "s3", country_code: "NG", region: "OY", city: "Ibadan" }),
  ];
  const { countries, regionsByCountry } = buildGeoHierarchy(rows, [], 3, 3);
  const ng = countries.find((c) => c.key === "NG");
  check("Nigeria country row: 2 distinct regions", ng.regions === 2, ng.regions);
  check("Nigeria country row: 3 distinct cities", ng.cities === 3, ng.cities);
  const laRegion = regionsByCountry.NG.find((r) => r.key === "LA");
  check("Lagos state region row: 2 distinct cities", laRegion.cities === 2, laRegion.cities);
}

console.log("5. Missing city falls back correctly (still counted at country/region level, invisible to city breakdown)");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "NG", region: "LA", city: null }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "NG", region: "LA", city: "Lagos" }),
  ];
  const { countries, regionsByCountry, citiesByCountry } = buildGeoHierarchy(rows, [], 2, 2);
  check("country row still counts both events", countries.find((c) => c.key === "NG").users === 2);
  check("region row still counts both events", regionsByCountry.NG.find((r) => r.key === "LA").users === 2);
  check("city breakdown only has the one row with a city", citiesByCountry.NG.length === 1 && citiesByCountry.NG[0].key === "Lagos");
}

console.log("6. Missing region falls back correctly (country still counts it, no region/city entry)");
{
  const rows = [ev({ visitor_id: "u1", session_id: "s1", country_code: "US", region: null, city: null })];
  const { countries, regionsByCountry, citiesByCountry } = buildGeoHierarchy(rows, [], 1, 1);
  check("country row counts the event", countries.find((c) => c.key === "US").users === 1);
  check("no region breakdown created for US", !regionsByCountry.US);
  check("no city breakdown created for US", !citiesByCountry.US);
}

console.log("7. Missing country becomes Unknown (never discarded, never fabricated)");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: null, region: null, city: null }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "NG", region: "LA", city: "Lagos" }),
  ];
  const { countries } = buildGeoHierarchy(rows, [], 2, 2);
  check("Unknown bucket exists", countries.some((c) => c.key === UNKNOWN));
  check("Unknown bucket has exactly the 1 event with no country", countries.find((c) => c.key === UNKNOWN).users === 1);
  check("no event is silently dropped", countries.reduce((sum, c) => sum + c.users, 0) === 2);
}

console.log("8. No fake location data is ever inserted -- output keys are exactly the input's real values");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "ng", region: "la", city: "Lagos" }), // lower-case on purpose
  ];
  const { countries } = buildGeoHierarchy(rows, [], 1, 1);
  const keys = countries.map((c) => c.key);
  check("country key is exactly what the row had (no normalization/fabrication here -- that already happened upstream)", keys.includes("ng"));
  check("no country the input never mentioned appears", keys.every((k) => k === "ng"));
}

console.log("9. Advertiser metrics (CTR, % of users/sessions) are computed correctly, not fabricated");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "NG" }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "NG" }),
    ev({ visitor_id: "u3", session_id: "s3", country_code: "US" }),
  ];
  const adRows = [
    ad({ event_type: "impression", country_code: "NG" }),
    ad({ event_type: "impression", country_code: "NG" }),
    ad({ event_type: "impression", country_code: "NG" }),
    ad({ event_type: "impression", country_code: "NG" }),
    ad({ event_type: "click", country_code: "NG" }),
  ];
  const { countries } = buildGeoHierarchy(rows, adRows, 3, 3);
  const ng = countries.find((c) => c.key === "NG");
  check("NG has 4 impressions, 1 click", ng.ad_impressions === 4 && ng.ad_clicks === 1);
  check("NG CTR is 25% (1/4)", ng.ctr === 25, ng.ctr);
  check("NG is 66.67% of users (2/3)", ng.pct_users === 66.67, ng.pct_users);
  const us = countries.find((c) => c.key === "US");
  check("US has 0 impressions -> CTR is null, not 0/0 or fabricated", us.ctr === null);
}

console.log("10. Countries work worldwide -- large, varied set, not a hand-picked handful");
{
  const codes = ["NG", "US", "GB", "GH", "IN", "ZA", "FR", "DE", "BR", "AU", "CA", "JP", "KE", "EG", "MX"];
  const rows = codes.map((code, i) => ev({ visitor_id: `u${i}`, session_id: `s${i}`, country_code: code, region: "X", city: "Y" }));
  const { countries } = buildGeoHierarchy(rows, [], codes.length, codes.length);
  check(`all ${codes.length} countries present`, countries.length === codes.length);
}

console.log("11. buildLocationRows: date x location x device x visitor-type grouping");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "NG", region: "LA", city: "Lagos", device_type: "mobile", created_at: "2026-09-28T09:00:00.000Z" }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "NG", region: "LA", city: "Lagos", device_type: "mobile", created_at: "2026-09-28T10:00:00.000Z" }),
    ev({ visitor_id: "u1", session_id: "s3", country_code: "NG", region: "LA", city: "Lagos", device_type: "mobile", created_at: "2026-09-29T09:00:00.000Z" }),
  ];
  // u1 is returning on day 2 (seen before `from`... here: seen in the window itself on an earlier date, which
  // is what the returning-set already encodes by the time it reaches buildLocationRows -- passed in directly).
  const returning = new Set(["u1"]);
  const locationRows = buildLocationRows(rows, [], returning);
  const day1 = locationRows.find((r) => r.date === "2026-09-28" && r.visitor_type === "returning");
  const day1new = locationRows.find((r) => r.date === "2026-09-28" && r.visitor_type === "new");
  check("u1 classified as returning", !!day1 && day1.sessions === 1);
  check("u2 classified as new", !!day1new && day1new.sessions === 1);
  check("rows are split by date", locationRows.some((r) => r.date === "2026-09-29"));
}

console.log("12. buildLocationRows: ad metrics land on a separate row, never duplicated onto visitor rows");
{
  const rows = [ev({ visitor_id: "u1", session_id: "s1", country_code: "NG", region: "LA", city: "Lagos", device_type: "mobile" })];
  const adRows = [
    ad({ event_type: "impression", country_code: "NG", region: "LA", city: "Lagos", device_type: "mobile" }),
    ad({ event_type: "impression", country_code: "NG", region: "LA", city: "Lagos", device_type: "mobile" }),
    ad({ event_type: "click", country_code: "NG", region: "LA", city: "Lagos", device_type: "mobile" }),
  ];
  const locationRows = buildLocationRows(rows, adRows, new Set());
  const visitorRow = locationRows.find((r) => r.visitor_type === "new");
  const adsRow = locationRows.find((r) => r.visitor_type === "ads");
  check("visitor row carries the session, zero ad numbers", visitorRow.sessions === 1 && visitorRow.ad_impressions === 0 && visitorRow.ad_clicks === 0);
  check("ads row carries the ad numbers, zero sessions", adsRow.sessions === 0 && adsRow.ad_impressions === 2 && adsRow.ad_clicks === 1);
  check(
    "totals are exactly right when you sum every row (nothing doubled, nothing dropped)",
    locationRows.reduce((s, r) => s + r.ad_impressions, 0) === 2 && locationRows.reduce((s, r) => s + r.ad_clicks, 0) === 1,
  );
}

console.log("13. Real (non-empty) production-shaped rows are included, not filtered out by accident");
{
  // Shaped like the actual rows seen in production: US/CA/Los Angeles and NG/LA/Lagos.
  const rows = [
    ev({ visitor_id: "p1", session_id: "ps1", country_code: "US", region: "CA", city: "Los Angeles" }),
    ev({ visitor_id: "p2", session_id: "ps2", country_code: "NG", region: "LA", city: "Lagos" }),
  ];
  const { countries, citiesByCountry } = buildGeoHierarchy(rows, [], 2, 2);
  check("US present with Los Angeles", citiesByCountry.US?.some((c) => c.key === "Los Angeles"));
  check("Nigeria present with Lagos", citiesByCountry.NG?.some((c) => c.key === "Lagos"));
  check("both countries counted", countries.length === 2);
}

console.log("14. Country names resolve correctly, worldwide (Intl.DisplayNames, not a hard-coded table)");
{
  check("US -> United States", countryName("US") === "United States");
  check("NG -> Nigeria", countryName("NG") === "Nigeria");
  check("GB -> United Kingdom", countryName("GB") === "United Kingdom");
  check("GH -> Ghana", countryName("GH") === "Ghana");
  check("IN -> India", countryName("IN") === "India");
  check("ZA -> South Africa", countryName("ZA") === "South Africa");
  check("null country -> null (never fabricated)", countryName(null) === null);
}

console.log("15. Region names resolve correctly, worldwide (ISO 3166-2 dataset, never Nigeria/US-only)");
{
  check("US-CA -> California", regionName("US", "CA") === "California");
  check("NG-LA -> Lagos", regionName("NG", "LA") === "Lagos");
  check("GB-ENG -> England", regionName("GB", "ENG") === "England");
  check("unrecognized code falls back to the raw code, never blank", regionName("US", "ZZ") === "ZZ");
  check("null region -> null", regionName("US", null) === null);
}

console.log("16. formatFullLocation: City, State/Region, Country hierarchy with correct fallbacks, no empty commas");
{
  check(
    "full: Los Angeles, California, United States",
    formatFullLocation("US", "CA", "Los Angeles") === "Los Angeles, California, United States",
    formatFullLocation("US", "CA", "Los Angeles"),
  );
  check(
    "full: Lagos, Lagos, Nigeria",
    formatFullLocation("NG", "LA", "Lagos") === "Lagos, Lagos, Nigeria",
    formatFullLocation("NG", "LA", "Lagos"),
  );
  check("no city -> State/Region, Country", formatFullLocation("US", "CA", null) === "California, United States");
  check("no region -> Country only", formatFullLocation("US", null, null) === "United States");
  check("no country -> Unknown", formatFullLocation(null, null, null) === "Unknown");
  check("no country even with city/region -> still Unknown (never fabricated)", formatFullLocation(null, "CA", "Los Angeles") === "Unknown");
  check("never an empty/dangling comma", !formatFullLocation("NG", null, null).includes(", ,") && !formatFullLocation("NG", null, null).startsWith(","));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
