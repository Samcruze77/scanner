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
  PROFILE_FIELDS,
  RECORD_FIELDS,
  adToRecord,
  eventToRecord,
  parseReportType,
  planFor,
} from "../../supabase/functions/_shared/exportRows.ts";
import { fetchAllByKeyset, chunk } from "../../supabase/functions/_shared/paginate.ts";
import { matchesFilters, parseFilters } from "../../supabase/functions/_shared/analyticsFilters.ts";
import { EXPORT_COLUMNS, CSV_HEADER, csvCell, csvLine, flattenRecord, jsonRecord, xlsxRow, exportFilename } from "../../utils/admin/exportFile.ts";
import { walkExport } from "../../utils/admin/exportPaging.ts";
import { buildExportUrl } from "../../utils/admin/exportClient.ts";

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

const profile = {
  admin_user_id: "11111111-1111-1111-1111-111111111111",
  admin_email: "admin@example.test",
  admin_display_name: null, // real-world null: must export empty, not invented
  admin_role: "super_admin",
  admin_is_active: true,
  admin_created_at: "2026-09-22T14:25:00Z",
  admin_updated_at: "2026-09-22T14:25:00Z",
};

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
  for (const f of PROFILE_FIELDS) check(`profile field ${f} exported`, EXPORT_COLUMNS.includes(f));
  for (const f of ["country_code", "country", "state_province", "state_province_name", "city_town", "county_district_lga", "neighborhood_suburb"]) {
    check(`geography column ${f}`, EXPORT_COLUMNS.includes(f));
  }
  for (const f of ["occurred_at", "visitor_id", "session_id", "path", "campaign_id", "campaign_name", "impressions", "clicks", "conversions", "browser", "operating_system", "device_type", "referrer"]) {
    check(`analytics column ${f}`, EXPORT_COLUMNS.includes(f));
  }
  check("no duplicate columns", new Set(EXPORT_COLUMNS).size === EXPORT_COLUMNS.length);
  check("header line matches columns", CSV_HEADER === EXPORT_COLUMNS.join(",") + "\r\n");
  check("profile fields come first (stable order)", EXPORT_COLUMNS.slice(0, PROFILE_FIELDS.length).join() === PROFILE_FIELDS.join());
  check("never selects ip_hash", !EVENT_SELECT.includes("ip_hash") && !AD_SELECT.includes("ip_hash") && !EXPORT_COLUMNS.some((c) => /ip_hash|secret|token|key/i.test(c)));
}

console.log("2. Row mapping copies real values; empty stays empty");
{
  const flat = flattenRecord(eventToRecord(eventRow(1), "new"), profile);
  check("profile present", flat.admin_email === "admin@example.test" && flat.admin_role === "super_admin");
  check("null profile field stays null", flat.admin_display_name === null);
  check("geography levels copied", flat.state_province === "State-1" && flat.city_town === "Town-1" && flat.county_district_lga === "District-1" && flat.neighborhood_suburb === "Suburb-1");
  check("empty referrer/postal stay empty", flat.referrer === null && flat.postal_code === null);
  check("event row has no ad metrics", flat.impressions === null && flat.clicks === null);
  const line = csvLine(flat).split(",");
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
  const j = jsonRecord(flat);
  check("JSON record omits per-row profile (emitted once at top level)", !("admin_email" in j) && j.state_province === "State-1");
  check("JSON keeps nulls as null", j.referrer === null);
  check("XLSX row aligns with columns", xlsxRow(flat).length === EXPORT_COLUMNS.length);
  check("filename", exportFilename("csv", "full", "2026-09-01", "2026-09-30") === "analytics-full-2026-09-01_to_2026-09-30.csv");
}

console.log("4. XLSX round-trips through a real workbook");
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Analytics export");
  ws.addRow([...EXPORT_COLUMNS]);
  ws.addRow(xlsxRow(flattenRecord(eventToRecord(eventRow(1), "new"), profile)));
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
    format: "xlsx",
    dateRange: { from: "2026-09-01", to: "2026-09-30" },
    filters: { country: "AA", state_province: "State-1", city_town: "Town-1", county_district_lga: "District-1", neighborhood_suburb: "Suburb-1", device: "mobile", visitorType: "new" },
  });
  const u = new URL(url, "http://x");
  check("route", u.pathname === "/api/admin/analytics-export");
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
  check("route only forwards whitelisted query params", /FORWARDED/.test(route));
  const cfg = read("../../supabase/config.toml");
  check("function registered", /\[functions\.admin-analytics-export\]/.test(cfg));
  const mig = read("../../supabase/migrations/20260930120000_add_geography_levels_and_export_support.sql");
  check("RPC locked to service_role", /revoke all on function public\.returning_visitor_ids/.test(mig) && /grant execute on function public\.returning_visitor_ids\(text\[\], timestamptz\) to service_role/.test(mig));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
