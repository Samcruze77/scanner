// Unit tests for the admin analytics export: row mapping, column set,
// CSV/JSON/XLSX cell formatting, filter/dataset equality with the dashboard,
// and paging (full dataset, no duplicates, no UI page limit). Pure functions
// plus a fake paged source -- no network.
//
// Run: node tests/analytics/export.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import {
  AD_SELECT,
  EVENT_SELECT,
  RECORD_FIELDS,
  adToRecord,
  eventToRecord,
  parseReportType,
  planFor,
} from "../../supabase/functions/_shared/exportRows.ts";
import { fetchAllByKeyset, chunk } from "../../supabase/functions/_shared/paginate.ts";
import { filtersToParams, hasAdFilters, matchesAdFilters, matchesFilters, parseFilters } from "../../supabase/functions/_shared/analyticsFilters.ts";
import { buildAdminProfile } from "../../supabase/functions/_shared/adminProfile.ts";
import { exportColumns, csvHeader, csvCell, csvLine, flattenRecord, flattenGeoRow, jsonRecord, xlsxRow, exportFilename } from "../../utils/admin/exportFile.ts";
import { GeoReportBuilder, SummaryBuilder } from "../../utils/admin/geoReport.ts";
import { walkExport } from "../../utils/admin/exportPaging.ts";
import { buildExportUrl, buildExportPageUrl } from "../../utils/admin/exportClient.ts";

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

// Built the way the Edge Function builds it: from the real rows. display_name
// is null in the real admin_users row and must export empty.
const profile = buildAdminProfile({
  adminRow: { user_id: "11111111-1111-1111-1111-111111111111", role: "super_admin", display_name: null, is_active: true, created_at: "2026-09-22T14:25:00Z", updated_at: "2026-09-22T14:25:00Z" },
  userProfileRow: null,
  authUser: { id: "11111111-1111-1111-1111-111111111111", email: "admin@example.test", phone: "", last_sign_in_at: "2026-09-29T10:00:00Z", created_at: "2026-09-22T14:20:00Z", updated_at: "2026-09-29T10:00:00Z", user_metadata: {} },
});
const EXPORT_COLUMNS = exportColumns(profile, "records");
const PROFILE_FIELDS = Object.keys(profile);
const CSV_HEADER = csvHeader(EXPORT_COLUMNS);
const csvLine1 = (row) => csvLine(row, EXPORT_COLUMNS);

const eventRow = (id, o = {}) => ({
  id,
  event_name: "page_view",
  visitor_id: `v${id}`,
  session_id: `s${id}`,
  user_id: null,
  path: "/scan",
  referrer: null,
  country_code: "AA",
  region: "State-1",
  city: "Town-1",
  county_district_lga: "District-1",
  neighborhood_suburb: "Suburb-1",
  postal_code: null,
  location_source: "vercel",
  device_type: "desktop",
  browser: "chrome",
  operating_system: "linux",
  properties: {},
  created_at: "2026-09-28T12:00:00.000Z",
  ...o,
});
const adRow = (id, o = {}) => ({
  id,
  event_type: "impression",
  campaign_id: "c1",
  creative_id: "cr1",
  slot_code: "top",
  session_id: "s1",
  user_id: null,
  path: "/",
  country_code: "AA",
  region: "State-1",
  city: "Town-1",
  county_district_lga: null,
  neighborhood_suburb: null,
  postal_code: null,
  location_source: "vercel",
  device_type: "desktop",
  created_at: "2026-09-28T12:00:00.000Z",
  ...o,
});

console.log("1. Column set: profile + every analytics field + all five geography levels");
{
  for (const f of ["admin_user_id", "admin_role", "admin_display_name", "admin_is_active", "admin_created_at", "admin_updated_at", "account_email", "account_last_sign_in_at"]) check(`profile field ${f} exported`, EXPORT_COLUMNS.includes(f));
  for (const f of ["country_code", "country", "state_province", "state_province_name", "city_town", "county_district_lga", "neighborhood_suburb", "postal_code", "location_source"]) {
    check(`geography column ${f}`, EXPORT_COLUMNS.includes(f));
  }
  for (const f of ["occurred_at", "visitor_id", "session_id", "path", "campaign_id", "campaign_name", "impressions", "clicks", "conversions", "browser", "operating_system", "device_type", "referrer"]) {
    check(`analytics column ${f}`, EXPORT_COLUMNS.includes(f));
  }
  check("no duplicate columns", new Set(EXPORT_COLUMNS).size === EXPORT_COLUMNS.length);
  check("header line matches columns", CSV_HEADER === EXPORT_COLUMNS.join(",") + "\r\n");
  check("neither hash nor tokens in header", !EXPORT_COLUMNS.some((c) => /password|token|hash|secret/i.test(c)));
  check("profile fields come first (stable order)", EXPORT_COLUMNS.slice(0, PROFILE_FIELDS.length).join() === PROFILE_FIELDS.join());
  check("never selects ip_hash", !EVENT_SELECT.includes("ip_hash") && !AD_SELECT.includes("ip_hash") && !EXPORT_COLUMNS.some((c) => /ip_hash|secret|token|key/i.test(c)));
}

console.log("2. Row mapping copies real values; empty stays empty");
{
  const flat = flattenRecord(eventToRecord(eventRow(1), "new"), profile);
  check("profile present", flat.account_email === "admin@example.test" && flat.admin_role === "super_admin");
  check("null profile field stays null", flat.admin_display_name === null);
  check("geography levels copied", flat.state_province === "State-1" && flat.city_town === "Town-1" && flat.county_district_lga === "District-1" && flat.neighborhood_suburb === "Suburb-1");
  check("empty referrer/postal stay empty", flat.referrer === null && flat.postal_code === null);
  check("event row has no ad metrics", flat.impressions === null && flat.clicks === null);
  const line = csvLine1(flat).split(",");
  check("CSV line has one cell per column", line.length === EXPORT_COLUMNS.length);
  check("null => empty CSV cell", line[EXPORT_COLUMNS.indexOf("admin_display_name")] === "");
  const legacy = flattenRecord(eventToRecord(eventRow(2, { county_district_lga: null, neighborhood_suburb: null, city: null }), "unknown"), profile);
  check("historical row: missing levels empty, no crash", legacy.county_district_lga === null && legacy.neighborhood_suburb === null && legacy.city_town === null);
  const ad = flattenRecord(adToRecord(adRow(3), new Map([["c1", "Campaign One"]])), profile);
  check("ad row metrics + campaign name", ad.impressions === 1 && ad.clicks === 0 && ad.campaign_name === "Campaign One");
  check("unknown campaign => empty name", adToRecord(adRow(4, { campaign_id: "zz" }), new Map()).campaign_name === null);
  check("conversion flag", eventToRecord(eventRow(5, { event_name: "conversion_completed" }), "new").conversions === 1);
  check("properties serialized only when present", eventToRecord(eventRow(6, { properties: { a: 1 } }), "new").properties === '{"a":1}' && eventToRecord(eventRow(7), "new").properties === null);
}

console.log("3. Cell formatting is safe and stable");
{
  check("comma/quote/newline quoted", csvCell('a,"b"\nc') === '"a,""b""\nc"');
  check("formula injection neutralized", csvCell("=HYPERLINK(1)") === "'=HYPERLINK(1)" && csvCell("+1") === "'+1" && csvCell("@x") === "'@x");
  check("numbers untouched", csvCell(-5) === "-5" && csvCell(0) === "0");
  check("boolean", csvCell(false) === "false");
  check("unicode preserved", csvCell("Zürich") === "Zürich");
  const flat = flattenRecord(eventToRecord(eventRow(1), "new"), profile);
  const j = jsonRecord(flat, EXPORT_COLUMNS, profile);
  check("JSON record omits per-row profile (emitted once at top level)", !("account_email" in j) && j.state_province === "State-1");
  check("JSON keeps nulls as null", j.referrer === null);
  check("XLSX row aligns with columns", xlsxRow(flat, EXPORT_COLUMNS).length === EXPORT_COLUMNS.length);
  check("filename", exportFilename("csv", "full", "2026-09-01", "2026-09-30") === "freepdfscanner-analytics-2026-09-01-to-2026-09-30.csv");
}

console.log("4. XLSX round-trips through a real workbook");
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Analytics export");
  ws.addRow([...EXPORT_COLUMNS]);
  ws.addRow(xlsxRow(flattenRecord(eventToRecord(eventRow(1), "new"), profile), EXPORT_COLUMNS));
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  const sheet = back.getWorksheet("Analytics export");
  check("header row", sheet.getRow(1).getCell(EXPORT_COLUMNS.indexOf("neighborhood_suburb") + 1).value === "neighborhood_suburb");
  check("value cell", sheet.getRow(2).getCell(EXPORT_COLUMNS.indexOf("neighborhood_suburb") + 1).value === "Suburb-1");
  check("empty cell stays empty", sheet.getRow(2).getCell(EXPORT_COLUMNS.indexOf("admin_display_name") + 1).value == null);
}

console.log("5. Report plans");
{
  check("full = events + ads", planFor("full").datasets.join() === "events,ads");
  check("advertising = ads only", planFor("advertising").datasets.join() === "ads");
  check("downloads filters event_name", planFor("downloads").eventNames.join() === "document_downloaded");
  check("invalid report rejected", parseReportType("nope") === null && parseReportType("full") === "full");
}

console.log("6. Paging: full dataset, no duplicates, independent of page size");
{
  const total = 2500;
  const events = Array.from({ length: total }, (_, i) => eventRow(i + 1));
  const ads = Array.from({ length: 1001 }, (_, i) => adRow(i + 1));
  const PAGE = 1000;
  // Fake of the Edge Function: keyset page over `source`, then filter -- the
  // same shape the deployed function returns.
  const fakeFetch = (filtersQs) => {
    const filters = parseFilters(new URLSearchParams(filtersQs));
    return async (dataset, after) => {
      const source = dataset === "events" ? events : ads;
      const scanned = source.filter((r) => r.id > after).slice(0, PAGE);
      const visible = scanned.filter((r) => matchesFilters(r, filters));
      return {
        profile,
        dataset,
        rows: visible.map((r) => (dataset === "events" ? eventToRecord(r, "new") : adToRecord(r, new Map()))),
        next_after: scanned.length === PAGE ? scanned[scanned.length - 1].id : null,
        scanned: scanned.length,
      };
    };
  };
  const collect = async (qs, datasets) => {
    const f = fakeFetch(qs);
    const first = await f(datasets[0], 0);
    const out = [];
    for await (const { record } of walkExport(f, datasets, first)) out.push(record);
    return out;
  };
  const all = await collect("", ["events", "ads"]);
  check("every event and ad exported (beyond one page)", all.length === total + 1001, String(all.length));
  const keys = all.map((r) => `${r.record_type}:${r.record_id}`);
  check("no duplicate rows", new Set(keys).size === keys.length);
  check("exact page boundary (1000 ads) terminates without loss", (await collect("", ["ads"])).length === 1001);
  const exactly = 2000;
  events.length = exactly;
  check("exact multiple of page size still complete", (await collect("", ["events"])).length === exactly);

  // Filtered export == filtered dataset
  events[10] = eventRow(11, { city: "Town-2" });
  events[1500] = eventRow(1501, { city: "Town-2", device_type: "mobile" });
  const town2 = await collect("city_town=Town-2", ["events"]);
  check("filter respected across pages", town2.length === 2 && town2.every((r) => r.city_town === "Town-2"));
  const town2Mobile = await collect("city_town=Town-2&device=mobile", ["events"]);
  check("combined filters", town2Mobile.length === 1 && town2Mobile[0].record_id === 1501);
  check("nothing matches => empty export, not an error", (await collect("county_district_lga=missing", ["events"])).length === 0);
}

console.log("7. fetchAllByKeyset fixes the 1000-row truncation");
{
  const rows = Array.from({ length: 3200 }, (_, i) => ({ id: i + 1 }));
  const { rows: got, error } = await fetchAllByKeyset(async (after, size) => ({ data: rows.filter((r) => r.id > after).slice(0, size), error: null }));
  check("all 3200 rows returned", got.length === 3200 && error === null);
  const failing = await fetchAllByKeyset(async (after) => (after === 0 ? { data: rows.slice(0, 1000), error: null } : { data: null, error: new Error("x") }));
  check("error surfaces (never a silently truncated set)", failing.error !== null);
  check("chunk", chunk([1, 2, 3, 4, 5], 2).length === 3);
}

console.log("8. Export URL carries the full selection (no browser-only state)");
{
  const url = buildExportUrl({
    reportType: "full",
    dateRange: { from: "2026-09-01", to: "2026-09-30" },
    filters: { country: "AA", state_province: "State-1", city_town: "Town-1", county_district_lga: "District-1", neighborhood_suburb: "Suburb-1", device: "mobile", visitor_type: "new", campaign_id: "22222222-2222-4222-8222-222222222222" },
  }, "xlsx");
  const u = new URL(url, "http://x");
  check("route", u.pathname === "/api/admin/analytics-export");
  check("campaign filter carried", u.searchParams.get("campaign_id") === "22222222-2222-4222-8222-222222222222" && u.searchParams.get("visitor_type") === "new");
  const page = new URL(buildExportPageUrl({ reportType: "geography", dateRange: { from: "2026-09-01", to: "2026-09-30" }, filters: { country: "AA", city_town: "Town-1", neighborhood_suburb: null } }), "http://x");
  check("export page URL", page.pathname === "/admin/exports" && page.searchParams.get("city_town") === "Town-1" && page.searchParams.get("report_type") === "geography" && !page.searchParams.has("neighborhood_suburb"));
  const back = parseFilters(page.searchParams);
  check("page URL round-trips through the shared parser", back.country === "AA" && back.city_town === "Town-1");
  for (const [k, v] of Object.entries({ format: "xlsx", from: "2026-09-01", to: "2026-09-30", country: "AA", state_province: "State-1", city_town: "Town-1", county_district_lga: "District-1", neighborhood_suburb: "Suburb-1", device: "mobile" })) {
    check(`param ${k}`, u.searchParams.get(k) === v);
  }
}

console.log("9. Security: authorization is enforced server-side and secrets are not exposed");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (p) => fs.readFileSync(path.join(here, p), "utf8");
  const fn = read("../../supabase/functions/admin-analytics-export/index.ts");
  check("edge function requires a verified user", /withSupabase\(\{ auth: "user" \}/.test(fn));
  check("edge function checks active admin", /is_active/.test(fn) && /Forbidden/.test(fn));
  check("edge function restricts to super_admin/admin", /"super_admin"/.test(fn) && /"admin"/.test(fn));
  const route = read("../../app/api/admin/analytics-export/route.ts");
  check("route verifies claims before doing anything", route.indexOf("getVerifiedClaims") < route.indexOf("fetchPage(token"));
  check("route forwards only the caller's token (no service key)", !/SERVICE_ROLE|SECRET_KEY/.test(route));
  check("route forwards only the parsed canonical selection", /filtersToParams\(filters\)/.test(route) && !/searchParams\.forEach|Object\.fromEntries\(url\.searchParams/.test(route));
  const cfg = read("../../supabase/config.toml");
  check("function registered", /\[functions\.admin-analytics-export\]/.test(cfg));
  const mig = read("../../supabase/migrations/20260930120000_add_geography_levels_and_export_support.sql");
  check("RPC locked to service_role", /revoke all on function public\.returning_visitor_ids/.test(mig) && /grant execute on function public\.returning_visitor_ids\(text\[\], timestamptz\) to service_role/.test(mig));
}


console.log("10. Geography report: aggregation matches the raw records exactly");
{
  const recs = [
    eventToRecord(eventRow(1, { visitor_id: "a", session_id: "s1" }), "new"),
    eventToRecord(eventRow(2, { visitor_id: "a", session_id: "s1", event_name: "conversion_completed" }), "new"),
    eventToRecord(eventRow(3, { visitor_id: "b", session_id: "s2" }), "new"),
    eventToRecord(eventRow(4, { visitor_id: "c", session_id: "s3", city: "Town-9", county_district_lga: null, neighborhood_suburb: null }), "new"),
    eventToRecord(eventRow(5, { visitor_id: "d", session_id: "s4", created_at: "2026-09-29T08:00:00.000Z" }), "new"),
    adToRecord(adRow(6, { session_id: "s1" }), new Map()),
    adToRecord(adRow(7, { event_type: "click", session_id: "s1" }), new Map()),
  ];
  const b = new GeoReportBuilder();
  recs.forEach((r) => b.add(r));
  const rows = b.rows();
  check("no duplicate group rows", new Set(rows.map((r) => JSON.stringify([r.date, r.country_code, r.state_province, r.city_town, r.county_district_lga, r.neighborhood_suburb, r.postal_code, r.location_source, r.device_type, r.browser]))).size === rows.length);
  const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  check("events sum == analytics records", sum("events") === 5);
  check("page views", sum("page_views") === 4);
  check("conversions", sum("conversions") === 1);
  check("ad impressions/clicks", sum("ad_impressions") === 1 && sum("ad_clicks") === 1);
  const main = rows.find((r) => r.city_town === "Town-1" && r.date === "2026-09-28" && r.browser === "chrome");
  check("distinct visitors/sessions per group", main.visitors === 2 && main.sessions === 2, JSON.stringify(main));
  const adRowOut = rows.find((r) => r.ad_impressions !== null);
  check("ad-only rows leave visitor/event metrics empty, not 0", adRowOut.visitors === null && adRowOut.events === null && adRowOut.sessions === 1);
  const noDistrict = rows.find((r) => r.city_town === "Town-9");
  check("missing levels stay null in the aggregate", noDistrict.county_district_lga === null && noDistrict.neighborhood_suburb === null);
  check("every geography field present on the row", ["country_code", "state_province", "city_town", "county_district_lga", "neighborhood_suburb", "postal_code", "location_source", "device_type", "browser", "first_event_at", "last_event_at"].every((k) => k in rows[0]));
  check("deterministic order (date ascending)", rows[0].date <= rows[rows.length - 1].date);
  const flat = flattenGeoRow(rows[0], profile);
  check("geography row carries admin profile + display names", flat.admin_role === "super_admin" && flat.account_email === "admin@example.test" && "country" in flat && "state_province_name" in flat);
  const cols = exportColumns(profile, "geography");
  check("geography columns = profile + report fields, no duplicates", new Set(cols).size === cols.length && cols.includes("visitors") && cols.includes("ad_clicks") && cols.includes("neighborhood_suburb"));
  const again = new GeoReportBuilder();
  [...recs].reverse().forEach((r) => again.add(r));
  check("aggregate independent of input order", JSON.stringify(again.rows()) === JSON.stringify(rows));

  console.log("11. Preview summary equals what the files contain, and only reports metrics that exist");
  const sb = new SummaryBuilder();
  recs.forEach((r) => sb.add(r));
  const full = sb.result(["events", "ads"]);
  check("records == raw record count", full.records === recs.length);
  check("visitors distinct", full.visitors === 4);
  check("sessions distinct across events and ads", full.sessions === 4);
  check("ad totals", full.ad_impressions === 1 && full.ad_clicks === 1);
  const adsOnly = new SummaryBuilder();
  recs.filter((r) => r.record_type === "ad_event").forEach((r) => adsOnly.add(r));
  const a = adsOnly.result(["ads"]);
  check("ads-only report has no visitor/page-view/conversion metrics", a.visitors === null && a.page_views === null && a.conversions === null && a.ad_impressions === 1);
  const eventsOnly = new SummaryBuilder();
  recs.filter((r) => r.record_type === "analytics_event").forEach((r) => eventsOnly.add(r));
  const e = eventsOnly.result(["events"]);
  check("events-only report has no ad metrics", e.ad_impressions === null && e.ad_clicks === null && e.page_views === 4);
  check("empty selection => zero records, not an error", new SummaryBuilder().result(["events"]).records === 0);
}

console.log("12. Every geography filter, alone and combined, selects exactly the matching records");
{
  const places = [
    { country_code: "AA", region: "State-1", city: "Town-1", county_district_lga: "District-1", neighborhood_suburb: "Suburb-1" },
    { country_code: "AA", region: "State-1", city: "Town-1", county_district_lga: "District-1", neighborhood_suburb: "Suburb-2" },
    { country_code: "AA", region: "State-1", city: "Town-1", county_district_lga: "District-2", neighborhood_suburb: null },
    { country_code: "AA", region: "State-2", city: "Town-1", county_district_lga: null, neighborhood_suburb: null }, // same city name, other state
    { country_code: "BB", region: "State-1", city: "Town-1", county_district_lga: "District-1", neighborhood_suburb: "Suburb-1" }, // same names, other country
  ];
  const data = places.map((p, i) => eventRow(i + 1, p));
  const select = (qs) => data.filter((r) => matchesFilters(r, parseFilters(new URLSearchParams(qs)))).map((r) => r.id);
  const eq = (qs, ids) => JSON.stringify(select(qs)) === JSON.stringify(ids);
  check("country", eq("country=AA", [1, 2, 3, 4]));
  check("state", eq("country=AA&state_province=State-1", [1, 2, 3]));
  check("city (name shared by two states is scoped by its state)", eq("country=AA&state_province=State-2&city_town=Town-1", [4]));
  check("county/district/LGA", eq("country=AA&state_province=State-1&city_town=Town-1&county_district_lga=District-1", [1, 2]));
  check("neighborhood", eq("country=AA&state_province=State-1&city_town=Town-1&county_district_lga=District-1&neighborhood_suburb=Suburb-2", [2]));
  check("URL-style aliases (state/city/lga/neighborhood)", eq("country=AA&state=State-1&city=Town-1&lga=District-1&neighborhood=Suburb-1", [1]));
  check("other country with identical names is not matched", !select("country=AA&state_province=State-1&city_town=Town-1&county_district_lga=District-1&neighborhood_suburb=Suburb-1").includes(5));
  check("no filters => all", eq("", [1, 2, 3, 4, 5]));
  check("filter matching nothing => empty", eq("neighborhood_suburb=Nowhere", []));
}

console.log("13. Campaign / creative / slot filters");
{
  const C = "11111111-1111-4111-8111-111111111111";
  const K = "33333333-3333-4333-8333-333333333333";
  const f = parseFilters(new URLSearchParams(`campaign_id=${C}&creative=${K}&slot=top`));
  check("parsed with aliases", f.campaign_id === C && f.creative_id === K && f.slot_code === "top");
  check("non-UUID campaign id ignored", parseFilters(new URLSearchParams("campaign_id=drop table")).campaign_id === null);
  check("matches", matchesAdFilters({ campaign_id: C, creative_id: K, slot_code: "top" }, f) && !matchesAdFilters({ campaign_id: C, creative_id: K, slot_code: "side" }, f));
  check("ad filters exclude analytics events from the plan", planFor("full", hasAdFilters(f)).datasets.join() === "ads");
  check("events-only report + ad filter => nothing to export (route returns a clear 400)", planFor("visitors", true).datasets.length === 0);
  check("geography report covers events + ads", planFor("geography").datasets.join() === "events,ads");
  const q = filtersToParams(f);
  check("canonical round trip", parseFilters(q).campaign_id === C && q.get("slot_code") === "top");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
