// What precision does the geography pipeline actually carry and show? Covers the
// request -> stored-fields -> coverage/hierarchy path for: country only, country+state,
// country+state+city, city+locality, unknown location, provider failure, malformed provider
// response, international locations, and several cities/states in one country. No network.
//
// Run: node tests/analytics/geo-precision.mjs

import { normalizeVercelGeo } from "../../utils/analytics/geo.ts";
import { createIp2LocationProvider, enrichRequestGeo, clearGeoCache } from "../../utils/analytics/geoProviders.ts";
import { normalizeGeoLevels } from "../../supabase/functions/_shared/geoFields.ts";
import { buildGeoCoverage, buildGeoHierarchy } from "../../supabase/functions/_shared/geoHierarchy.ts";

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => (ok ? pass++ : (fail++, console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`)));

// A stored row as the admin function reads it, built from a Vercel geo header set.
function stored(geo, extra = {}) {
  const n = normalizeVercelGeo(geo);
  return { event_name: "page_view", visitor_id: "v", session_id: "s", user_id: null, country_code: n.countryCode, region: n.region, city: n.city, county_district_lga: n.countyDistrictLga, neighborhood_suburb: n.neighborhoodSuburb, location_source: n.countryCode ? n.source : null, device_type: "desktop", created_at: "2026-09-01T00:00:00Z", ...extra };
}
const cov = (rows) => buildGeoCoverage(rows);

// 1. country only
{
  const c = cov([stored({ country: "KE" })]);
  check("country only: country 1, deeper levels 0", c.country === 1 && c.state_province === 0 && c.city_town === 0 && c.neighborhood_suburb === 0);
}
// 2. country + state
{
  const c = cov([stored({ country: "NG", countryRegion: "LA" })]);
  check("country+state: state 1, city 0", c.state_province === 1 && c.city_town === 0);
  const h = buildGeoHierarchy([stored({ country: "NG", countryRegion: "LA" })], [], 1, 1);
  check("country+state: state node exists, no city node", h.levels.state_province.length === 1 && h.levels.city_town.length === 0);
}
// 3. country + state + city (Vercel's maximum)
{
  const rows = [stored({ country: "NG", countryRegion: "LA", city: "Lagos" })];
  const c = cov(rows);
  check("country+state+city: city 1, district/neighborhood 0", c.city_town === 1 && c.county_district_lga === 0 && c.neighborhood_suburb === 0);
  check("vercel never supplies locality", rows[0].neighborhood_suburb === null && rows[0].county_district_lga === null);
  check("source recorded", c.sources.length === 1 && c.sources[0].source === "vercel");
}
// 4. city + locality (only when a provider really returns one; nothing is inferred from the city)
{
  const lv = normalizeGeoLevels({ country_code: "NG", region: "LA", city: "Lagos", neighborhood_suburb: "Ikeja GRA" });
  check("locality passes through when supplied", lv.neighborhood_suburb === "Ikeja GRA" && lv.city_town === "Lagos");
  const lagosOnly = normalizeGeoLevels({ country_code: "NG", region: "LA", city: "Lagos" });
  check("Lagos alone gets NO neighborhood", lagosOnly.neighborhood_suburb === null && lagosOnly.county_district_lga === null);
  const rows = [{ ...stored({ country: "NG", countryRegion: "LA", city: "Lagos" }), neighborhood_suburb: "Ikeja GRA", location_source: "ip2location" }];
  const c = cov(rows);
  check("coverage counts the locality", c.neighborhood_suburb === 1 && c.sources[0].source === "ip2location");
}
// 5. unknown location
{
  const rows = [stored({}), stored(null), stored(undefined)];
  const c = cov(rows);
  check("unknown: no country, no levels", c.events === 3 && c.country === 0 && c.state_province === 0);
  check("unknown: source unrecorded, not invented", c.sources.length === 1 && c.sources[0].source === "unrecorded");
  const h = buildGeoHierarchy(rows, [], 1, 1);
  check("unknown rows group under Unknown only", h.countries.length === 1 && h.countries[0].key === "Unknown" && h.levels.city_town.length === 0);
}
// 6. malformed Vercel header must not throw (city is percent-encoded by Vercel)
{
  let threw = false;
  let g;
  try { g = normalizeVercelGeo({ country: "NG", city: "%E0%A4%A" }); } catch { threw = true; }
  check("malformed percent-encoding does not throw", !threw);
  check("encoded city decodes", normalizeVercelGeo({ country: "BR", city: "S%C3%A3o%20Paulo" }).city === "São Paulo");
  check("malformed city keeps country", !threw && g.countryCode === "NG");
}
// 7. provider failure / malformed provider response never break the request and never add data
{
  clearGeoCache();
  const base = { countryCode: "NG", region: "LA", city: "Lagos", countyDistrictLga: null, neighborhoodSuburb: null, postalCode: null, source: "vercel", clientIp: "8.8.8.8" };
  const cfg = { provider: "ip2location", apiKey: "k", timeoutMs: 500 };
  const failing = createIp2LocationProvider("k", async () => { throw new Error("network down"); });
  const r1 = await enrichRequestGeo(base, cfg, failing);
  check("provider throws: vercel result unchanged", r1.city === "Lagos" && r1.neighborhoodSuburb === null);
  clearGeoCache();
  const http500 = createIp2LocationProvider("k", async () => new Response("x", { status: 500 }));
  const r2 = await enrichRequestGeo({ ...base, clientIp: "8.8.4.4" }, cfg, http500);
  check("provider 500: unchanged", r2.city === "Lagos" && r2.neighborhoodSuburb === null);
  clearGeoCache();
  const garbage = createIp2LocationProvider("k", async () => new Response("<html>not json</html>", { status: 200 }));
  const r3 = await enrichRequestGeo({ ...base, clientIp: "1.1.1.1" }, cfg, garbage);
  check("provider non-JSON: unchanged", r3.city === "Lagos");
  clearGeoCache();
  const placeholders = createIp2LocationProvider("k", async () => Response.json({ country_code: "NG", region_name: "-", city_name: "-", district: "-" }));
  const r4 = await enrichRequestGeo({ ...base, clientIp: "9.9.9.9" }, cfg, placeholders);
  check("placeholder values ('-') never stored", r4.city === "Lagos" && r4.countyDistrictLga === null);
  clearGeoCache();
  const wrongCountry = createIp2LocationProvider("k", async () => Response.json({ country_code: "US", region_name: "California", city_name: "Los Angeles", district: "Hollywood" }));
  const r5 = await enrichRequestGeo({ ...base, clientIp: "9.9.9.10" }, cfg, wrongCountry);
  check("provider disagreeing on country is ignored", r5.countryCode === "NG" && r5.city === "Lagos" && r5.countyDistrictLga === null);
  clearGeoCache();
  const noIp = await enrichRequestGeo({ ...base, clientIp: null }, cfg, failing);
  check("no client IP: no lookup, unchanged", noIp.city === "Lagos");
}
// 8. international + several cities/states in one country keep separate nodes
{
  const rows = [
    stored({ country: "NG", countryRegion: "LA", city: "Lagos" }, { visitor_id: "a", session_id: "a1" }),
    stored({ country: "NG", countryRegion: "LA", city: "Ikeja" }, { visitor_id: "b", session_id: "b1" }),
    stored({ country: "NG", countryRegion: "FC", city: "Abuja" }, { visitor_id: "c", session_id: "c1" }),
    stored({ country: "US", countryRegion: "CA", city: "Springfield" }, { visitor_id: "d", session_id: "d1" }),
    stored({ country: "US", countryRegion: "IL", city: "Springfield" }, { visitor_id: "e", session_id: "e1" }),
    stored({ country: "JP", countryRegion: "13", city: "Tokyo" }, { visitor_id: "f", session_id: "f1" }),
    stored({ country: "BR", countryRegion: "SP", city: "S%C3%A3o%20Paulo" }, { visitor_id: "g", session_id: "g1" }),
    stored({ country: "GB" }, { visitor_id: "h", session_id: "h1" }),
  ];
  const h = buildGeoHierarchy(rows, [], 8, 8);
  check("5 countries", h.countries.filter((c) => c.key !== "Unknown").length === 5);
  check("two NG states", h.levels.state_province.filter((s) => s.path.country === "NG").length === 2);
  check("Springfield in two US states stays two cities", h.levels.city_town.filter((c) => c.path.city_town === "Springfield").length === 2);
  check("three NG cities", h.levels.city_town.filter((c) => c.path.country === "NG").length === 3);
  check("country-only GB adds no state/city", !h.levels.state_province.some((s) => s.path.country === "GB") && !h.levels.city_town.some((c) => c.path.country === "GB"));
  check("non-ASCII city kept", h.levels.city_town.some((c) => c.path.city_town === "São Paulo"));
  check("no neighborhood nodes invented anywhere", h.levels.neighborhood_suburb.length === 0 && h.levels.county_district_lga.length === 0);
  const c = cov(rows);
  check("coverage across countries", c.events === 8 && c.country === 8 && c.state_province === 7 && c.city_town === 7 && c.neighborhood_suburb === 0);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
