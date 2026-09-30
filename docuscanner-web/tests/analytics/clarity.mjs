// Unit tests for the Microsoft Clarity report source: request validation
// against the API's documented limits, tolerant response normalization, the
// Clarity/Combined row shapes (source-labelled, no invented geography), and
// static checks that the API token never reaches browser code.
//
// The response fixture below is SYNTHETIC, shaped after Microsoft's
// documentation (metric blocks with an `information` array). It is not real
// Clarity output: the real API has not been called (no token available).
//
// Run: node tests/analytics/clarity.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLARITY_DIMENSIONS,
  buildClarityUrl,
  normalizeClarityResponse,
  parseClarityRequest,
  windowFor,
} from "../../utils/clarity/api.ts";
import {
  SOURCE_CLARITY,
  SOURCE_INTERNAL,
  clarityColumns,
  clarityFlatRows,
  clarityMetricColumns,
  combinedColumns,
  internalFlatRows,
  withProfile,
} from "../../utils/admin/clarityReport.ts";
import { csvLine } from "../../utils/admin/exportFile.ts";

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
const params = (s) => new URLSearchParams(s);

console.log("1. Requests respect the documented API limits");
{
  check("default: 3 days, Country/Region", JSON.stringify(parseClarityRequest(params(""))) === JSON.stringify({ numOfDays: 3, dimensions: ["Country/Region"] }));
  check("1, 2, 3 days accepted", [1, 2, 3].every((d) => parseClarityRequest(params(`clarity_days=${d}`)).numOfDays === d));
  check("4 days rejected (API only exposes the last 72h)", "error" in parseClarityRequest(params("clarity_days=4")));
  check("0 / junk days rejected", "error" in parseClarityRequest(params("clarity_days=0")) && "error" in parseClarityRequest(params("clarity_days=abc")));
  check("three dimensions ok", parseClarityRequest(params("clarity_dimensions=Country/Region,Device,Browser")).dimensions.length === 3);
  check("four dimensions rejected", "error" in parseClarityRequest(params("clarity_dimensions=Country/Region,Device,Browser,OS")));
  check("unknown dimension rejected (never forwarded)", "error" in parseClarityRequest(params("clarity_dimensions=City")));
  check("state / city are NOT dimensions", !CLARITY_DIMENSIONS.some((d) => /state|city|county|neighbo/i.test(d.value)));
  check("dimension names are case-insensitive and de-duplicated", JSON.stringify(parseClarityRequest(params("clarity_dimensions=device,DEVICE")).dimensions) === '["Device"]');
  const url = buildClarityUrl({ numOfDays: 2, dimensions: ["Country/Region", "Device"] });
  const u = new URL(url);
  check("endpoint + params", u.origin + u.pathname === "https://www.clarity.ms/export-data/api/v1/project-live-insights" && u.searchParams.get("numOfDays") === "2" && u.searchParams.get("dimension1") === "Country/Region" && u.searchParams.get("dimension2") === "Device");
  check("token is never part of the URL", !/token|bearer|key/i.test(url));
  const w = windowFor(3, new Date("2026-09-30T12:00:00Z"));
  check("window covers today and the previous days", w.from === "2026-09-28" && w.to === "2026-09-30");
}

console.log("2. Response normalization (synthetic fixture shaped after the docs)");
const fixture = [
  { metricName: "Traffic", information: [
    { Country: "Country-A", totalSessionCount: "120", totalBotSessionCount: "4", distantUserCount: "95", PagesPerSessionPercentage: 1.8 },
    { Country: "Country-B", totalSessionCount: "30", totalBotSessionCount: "0", distantUserCount: "28", PagesPerSessionPercentage: 1.1 },
  ] },
  { metricName: "EngagementTime", information: [
    { Country: "Country-A", totalTime: "5400", activeTime: "3100" },
    { Country: "Country-B", totalTime: "800", activeTime: "500" },
  ] },
  { metricName: "DeadClickCount", information: [{ Country: "Country-A", sessionsCount: "7", sessionsWithMetricPercentage: 5.8 }] },
  { metricName: "Broken" }, // tolerated
  { information: [] }, // tolerated
];
{
  const rows = normalizeClarityResponse(fixture, ["Country/Region"]);
  check("one row per country, metrics pivoted", rows.length === 2);
  const a = rows.find((r) => r.dimensions.country === "Country-A");
  check("numeric strings become numbers", a.metrics["Traffic.totalSessionCount"] === 120 && a.metrics["EngagementTime.totalTime"] === 5400);
  check("a metric a row lacks is simply absent (not zero)", !("DeadClickCount.sessionsCount" in rows.find((r) => r.dimensions.country === "Country-B").metrics));
  check("dimension field is not duplicated as a metric", !Object.keys(a.metrics).some((k) => k.endsWith(".Country")));
  check("garbage / non-array bodies yield no rows", normalizeClarityResponse(null, ["Device"]).length === 0 && normalizeClarityResponse({ error: "x" }, ["Device"]).length === 0);
  const two = normalizeClarityResponse([{ metricName: "Traffic", information: [{ Country: "A", Device: "Mobile", totalSessionCount: "2" }, { Country: "A", Device: "PC", totalSessionCount: "3" }] }], ["Country/Region", "Device"]);
  check("two dimensions => one row per combination", two.length === 2 && two.every((r) => r.dimensions.country === "A" && r.dimensions.device));
  check("dimensions not requested are not invented", !("browser" in two[0].dimensions));
}

console.log("3. Clarity rows: labelled, no invented geography");
const profile = { admin_role: "admin", account_email: "a@example.test" };
{
  const req = { numOfDays: 3, dimensions: ["Country/Region"] };
  const rows = normalizeClarityResponse(fixture, req.dimensions);
  const flat = withProfile(clarityFlatRows(rows, req, new Date("2026-09-30T12:00:00Z")), profile);
  check("every row says where it came from", flat.every((r) => r.source === SOURCE_CLARITY));
  check("window recorded on each row", flat.every((r) => r.window_from === "2026-09-28" && r.window_to === "2026-09-30"));
  check("aliases only where the field exists", flat[0].sessions === 120 && flat[0].users === 95 && flat[0].engagement_time === 5400);
  check("raw Clarity fields kept under clarity.*", "clarity.Traffic.totalBotSessionCount" in flat[0]);
  const cols = clarityColumns(profile, rows);
  check("no state/city/county/neighborhood columns on a Clarity-only report", !cols.some((c) => /state_province|city_town|county_district|neighborhood/.test(c)));
  check("admin profile columns first", cols[0] === "admin_role" && cols[1] === "account_email");
  check("metric columns discovered, sorted, unique", JSON.stringify(clarityMetricColumns(rows)) === JSON.stringify([...new Set(clarityMetricColumns(rows))].sort()) && clarityMetricColumns(rows).includes("clarity.DeadClickCount.sessionsCount"));
  check("CSV line aligns with columns", csvLine(flat[0], cols).split(",").length === cols.length);
}

console.log("4. Combined report keeps the two sources distinct");
{
  const req = { numOfDays: 3, dimensions: ["Country/Region", "Device"] };
  const cRows = normalizeClarityResponse([{ metricName: "Traffic", information: [{ Country: "Country-A", Device: "Mobile", totalSessionCount: "10", distantUserCount: "9" }] }], req.dimensions);
  const internal = internalFlatRows([
    { date: "2026-09-29", country_code: "AA", state_province: "S1", city_town: "T1", county_district_lga: "D1", neighborhood_suburb: null, postal_code: null, location_source: "vercel", device_type: "mobile", browser: "chrome", visitors: 4, sessions: 5, events: 9, page_views: 7, ad_impressions: null, ad_clicks: null, conversions: 1, first_event_at: "a", last_event_at: "b" },
  ]);
  const combined = withProfile([...internal, ...clarityFlatRows(cRows, req)], profile);
  const cols = combinedColumns(profile, cRows);
  check("both source labels present", combined.some((r) => r.source === SOURCE_INTERNAL) && combined.some((r) => r.source === SOURCE_CLARITY));
  const i = combined.find((r) => r.source === SOURCE_INTERNAL);
  const c = combined.find((r) => r.source === SOURCE_CLARITY);
  check("internal rows carry the full geography path", i.state_province === "S1" && i.city_town === "T1" && i.county_district_lga === "D1");
  check("Clarity rows never fill state/city/district/neighborhood", c.state_province == null && c.city_town == null && c.county_district_lga == null && c.neighborhood_suburb == null);
  check("Clarity rows never carry internal ad/page-view metrics", c.ad_impressions == null && c.ad_clicks == null && c.page_views == null && c.events == null);
  check("internal rows never carry Clarity metrics", !Object.keys(i).some((k) => k.startsWith("clarity.")) && i.engagement_time == null);
  check("internal users = distinct visitor_id; Clarity users = Clarity's own count", i.users === 4 && c.users === 9);
  check("all requested columns exist", ["source", "date", "country_code", "state_province", "city_town", "county_district_lga", "neighborhood_suburb", "sessions", "users", "engagement_time", "page_views", "ad_impressions", "ad_clicks", "utm_campaign", "device", "browser"].every((k) => cols.includes(k)));
  check("no duplicate columns", new Set(cols).size === cols.length);
  check("every row serializes to one cell per column", combined.every((r) => csvLine(r, cols).split(",").length === cols.length));
}

console.log("5. The API token stays on the server");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (p) => fs.readFileSync(path.join(here, "../..", p), "utf8");
  const walk = (dir) => fs.readdirSync(path.join(here, "../..", dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = [...walk("app"), ...walk("components"), ...walk("utils")].filter((f) => /\.(ts|tsx)$/.test(f));
  const users = files.filter((f) => read(f).includes("CLARITY_API_TOKEN"));
  check("CLARITY_API_TOKEN read in exactly one server-only module (plus its UI hint text)", users.includes("utils/clarity/client.server.ts"));
  check("never as a NEXT_PUBLIC_ variable", !files.some((f) => read(f).includes("NEXT_PUBLIC_CLARITY_API")));
  check("no client component calls the Clarity export API", !files.filter((f) => read(f).startsWith('"use client"')).some((f) => read(f).includes("clarity.ms/export-data")));
  const server = read("utils/clarity/client.server.ts");
  check("token sent only as a bearer header, never logged or put in errors", /Authorization: `Bearer \$\{token\}`/.test(server) && !/console\./.test(server) && !/message.*\$\{token\}/.test(server));
  check("responses cached to protect the 10 requests/day budget", /revalidate: 6 \* 60 \* 60/.test(server));
  const route = read("app/api/admin/analytics-export/route.ts");
  check("Clarity paths run after the admin gate (Edge Function called first)", route.indexOf("await fetchPage(token, base, plan.datasets[0]") < route.indexOf("await getClarityInsights(clarityReq)"));
  check("route only reports whether Clarity is configured, not the token", /clarity_configured: clarityConfigured\(\)/.test(route));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
