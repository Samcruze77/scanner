// Unit tests for the geography provider layer: provider config, the
// IP2Location adapter, merge policy (Vercel is never replaced), privacy
// properties (no IP/key leakage, IP only cached as a digest), timeouts and
// caching, and the historical backfill planner. No network.
//
// Run: node tests/analytics/geo-providers.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanPlace,
  clearGeoCache,
  createIp2LocationProvider,
  createIpProvider,
  enrichRequestGeo,
  isPublicIp,
  lookupWithCache,
  mergeGeo,
  readGeoProviderConfig,
} from "../../utils/analytics/geoProviders.ts";
import { planBackfill } from "../../utils/analytics/geoBackfill.ts";

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

const vercel = (o = {}) => ({ countryCode: "AA", region: "S1", city: "Town-1", countyDistrictLga: null, neighborhoodSuburb: null, postalCode: "111", source: "vercel", ...o });
const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

console.log("1. Configuration comes only from environment variables");
{
  check("unset => off", readGeoProviderConfig({}).provider === "none");
  check("provider without a key => off", readGeoProviderConfig({ GEO_PROVIDER: "ip2location" }).provider === "none");
  check("provider + key => on", readGeoProviderConfig({ GEO_PROVIDER: "IP2Location", GEO_PROVIDER_API_KEY: "k" }).provider === "ip2location");
  check("unknown provider => off", readGeoProviderConfig({ GEO_PROVIDER: "x", GEO_PROVIDER_API_KEY: "k" }).provider === "none");
  check("timeout bounded", readGeoProviderConfig({ GEO_PROVIDER_TIMEOUT_MS: "999999" }).timeoutMs === 1200 && readGeoProviderConfig({ GEO_PROVIDER_TIMEOUT_MS: "800" }).timeoutMs === 800);
  check("no provider object when off", createIpProvider(readGeoProviderConfig({})) === null);
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../utils/analytics/geoProviders.ts"), "utf8");
  check("no hard-coded credential in source", !/key=[A-Za-z0-9]{12,}|apikey\\s*[:=]\\s*["'][A-Za-z0-9]{12,}/i.test(src));
}

console.log("2. IP2Location adapter maps the response onto canonical fields");
{
  let seen;
  const provider = createIp2LocationProvider("SECRETKEY", async (url) => {
    seen = String(url);
    return jsonRes({ country_code: "aa", country_name: "Country-A", region_name: "State-1", city_name: "Town-1", district: "District-1", zip_code: "111", latitude: "1.5", longitude: 2.5 });
  });
  const out = await provider.lookup("8.8.8.8", new AbortController().signal);
  check("country/region/city", out.countryCode === "AA" && out.region === "State-1" && out.city === "Town-1");
  check("district -> county_district_lga", out.countyDistrictLga === "District-1");
  check("postal + coordinates", out.postalCode === "111" && out.latitude === 1.5 && out.longitude === 2.5);
  check("neighborhood null when provider has none", out.neighborhoodSuburb === null);
  check("key and ip sent as query params over https", seen.startsWith("https://api.ip2location.io/") && seen.includes("key=SECRETKEY") && seen.includes("ip=8.8.8.8"));
  const sparse = await createIp2LocationProvider("k", async () => jsonRes({ country_code: "AA", city_name: "-", district: "-", region_name: "" })).lookup("8.8.8.8", new AbortController().signal);
  check("placeholders (-, empty) become null, never values", sparse.city === null && sparse.countyDistrictLga === null && sparse.region === null);
  check("plan without district field => null", (await createIp2LocationProvider("k", async () => jsonRes({ country_code: "AA", city_name: "Town-1" })).lookup("8.8.8.8", new AbortController().signal)).countyDistrictLga === null);
  check("no country => null result", (await createIp2LocationProvider("k", async () => jsonRes({ country_code: "-" })).lookup("8.8.8.8", new AbortController().signal)) === null);
  let err;
  try {
    await createIp2LocationProvider("SECRETKEY", async () => jsonRes({}, 429)).lookup("8.8.8.8", new AbortController().signal);
  } catch (e) {
    err = e;
  }
  check("HTTP failure error contains neither key nor ip", err && !String(err.message).includes("SECRETKEY") && !String(err.message).includes("8.8.8.8"), err?.message);
  check("cleanPlace", cleanPlace(" Town ") === "Town" && cleanPlace("N/A") === null && cleanPlace(5) === null);
}

console.log("3. Merge policy: Vercel stays the baseline");
{
  const m = mergeGeo(vercel(), { countryCode: "AA", region: "Other-Name", city: "Town-1", countyDistrictLga: "District-1", neighborhoodSuburb: "Suburb-1", postalCode: "999" }, "ip2location");
  check("Vercel region/postal not replaced", m.region === "S1" && m.postalCode === "111");
  check("county + neighborhood filled", m.countyDistrictLga === "District-1" && m.neighborhoodSuburb === "Suburb-1");
  check("source records the enrichment", m.source === "vercel+ip2location");
  check("city compared case-insensitively", mergeGeo(vercel({ city: "TOWN-1" }), { countryCode: "AA", city: "town-1", countyDistrictLga: "D" }, "ip2location").countyDistrictLga === "D");
  const conflict = mergeGeo(vercel(), { countryCode: "AA", city: "Town-2", countyDistrictLga: "District-9" }, "ip2location");
  check("provider disagreeing on city => nothing merged (no mixed paths)", conflict.countyDistrictLga === null && conflict.source === "vercel");
  const otherCountry = mergeGeo(vercel(), { countryCode: "BB", city: "Town-1", countyDistrictLga: "D" }, "ip2location");
  check("provider disagreeing on country ignored", otherCountry.countyDistrictLga === null && otherCountry.countryCode === "AA");
  check("nothing new => source unchanged", mergeGeo(vercel(), { countryCode: "AA", city: "Town-1" }, "ip2location").source === "vercel");
  check("no provider data => baseline", mergeGeo(vercel(), null, "ip2location").source === "vercel");
  const noVercelCity = mergeGeo(vercel({ city: null }), { countryCode: "AA", city: "Town-5", countyDistrictLga: "D" }, "ip2location");
  check("fills a level Vercel lacks", noVercelCity.city === "Town-5" && noVercelCity.countyDistrictLga === "D");
  const noVercel = mergeGeo({ countryCode: null, region: null, city: null, countyDistrictLga: null, neighborhoodSuburb: null, postalCode: null, source: "unknown" }, { countryCode: "AA", city: "Town-1" }, "ip2location");
  check("provider used when Vercel had nothing", noVercel.countryCode === "AA" && noVercel.source === "ip2location");
  check("coordinates are not part of the stored shape", !("latitude" in m) || m.latitude === undefined);
}

console.log("4. Lookup: timeout, caching, failure isolation, privacy");
{
  clearGeoCache();
  let calls = 0;
  const ok = { name: "p", async lookup() { calls++; return { countryCode: "AA", countyDistrictLga: "D" }; } };
  await lookupWithCache(ok, "8.8.8.8", 500);
  await lookupWithCache(ok, "8.8.8.8", 500);
  check("cached: one upstream call for repeated IP", calls === 1);
  await lookupWithCache(ok, "8.8.4.4", 500);
  check("different IP looked up separately", calls === 2);
  clearGeoCache();
  const slow = { name: "slow", lookup: (_ip, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) };
  const t0 = Date.now();
  const r = await lookupWithCache(slow, "8.8.8.8", 60);
  check("timeout returns null quickly", r === null && Date.now() - t0 < 1000);
  let logged = "";
  const orig = console.error;
  console.error = (...a) => (logged += a.join(" "));
  clearGeoCache();
  await lookupWithCache({ name: "bad", async lookup() { throw new Error("boom 8.8.8.8 key=SECRET"); } }, "8.8.8.8", 100);
  console.error = orig;
  check("failure is swallowed and logged without ip/key", !logged.includes("8.8.8.8") && !logged.includes("SECRET"), logged);
  const failing = { name: "f", async lookup() { throw new Error("x"); } };
  clearGeoCache();
  const base = { ...vercel(), clientIp: "8.8.8.8" };
  console.error = () => {};
  const enriched = await enrichRequestGeo(base, { provider: "ip2location", apiKey: "k", timeoutMs: 100 }, failing);
  console.error = orig;
  check("provider failure leaves the Vercel result untouched", enriched.city === "Town-1" && enriched.source === "vercel");
  check("no provider => baseline returned as is", (await enrichRequestGeo(base, { provider: "none", apiKey: "", timeoutMs: 100 }, null)) === base);
  let called = false;
  await enrichRequestGeo({ ...base, clientIp: "192.168.1.5" }, { provider: "ip2location", apiKey: "k", timeoutMs: 100 }, { name: "p", async lookup() { called = true; return null; } });
  check("private/loopback IPs are never sent to a third party", !called);
  check("isPublicIp", isPublicIp("8.8.8.8") && isPublicIp("2001:4860:4860::8888") && !isPublicIp("10.0.0.1") && !isPublicIp("172.20.1.1") && !isPublicIp("127.0.0.1") && !isPublicIp("::1") && !isPublicIp("fe80::1") && !isPublicIp(""));
}

console.log("5. Historical backfill never fabricates");
{
  const row = (o) => ({ id: 1, country_code: "AA", region: "S1", city: "T1", postal_code: "111", county_district_lga: null, neighborhood_suburb: null, ...o });
  const none = await planBackfill([row({ id: 1 }), row({ id: 2 })], null);
  check("no resolver => no usable source, no updates", none.noUsableSource === 2 && none.updates.length === 0);
  const resolver = {
    name: "r",
    canResolve: (r) => !!r.postal_code,
    resolve: async (r) => (r.id === 1 ? { county_district_lga: "D-1", neighborhood_suburb: null } : r.id === 2 ? { county_district_lga: "-", neighborhood_suburb: "" } : null),
  };
  const rep = await planBackfill([row({ id: 1 }), row({ id: 2 }), row({ id: 3, postal_code: null }), row({ id: 4, county_district_lga: "Have", neighborhood_suburb: "Have" }), row({ id: 5, county_district_lga: "Keep" })], resolver);
  check("only the real value is written", rep.updates.length === 1 && rep.updates[0].id === 1 && rep.updates[0].set.county_district_lga === "D-1" && !("neighborhood_suburb" in rep.updates[0].set));
  check("placeholder answers leave null", rep.unresolved >= 1);
  check("row without source data skipped", rep.noUsableSource === 1);
  check("complete rows untouched", rep.alreadyComplete === 1);
  check("existing values never overwritten", !rep.updates.some((u) => u.id === 5 && "county_district_lga" in u.set));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
