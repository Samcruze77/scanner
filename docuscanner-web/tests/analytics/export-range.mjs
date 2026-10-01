// Date-range behaviour of the admin export: range parsing (inclusive UTC days, strict
// validation), the picker's validation, and an end-to-end CSV built through the same
// resolveRange -> predicate -> walkExport -> csv path as the route, verified row by row.
// Writes tests/analytics/out/freepdfscanner-analytics-*.csv as inspectable samples.
//
// Run: node tests/analytics/export-range.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRange, parseFilters, matchesFilters, isValidDateParam } from "../../supabase/functions/_shared/analyticsFilters.ts";
import { eventToRecord } from "../../supabase/functions/_shared/exportRows.ts";
import { buildAdminProfile } from "../../supabase/functions/_shared/adminProfile.ts";
import { CSV_BOM, csvHeader, csvLine, exportColumns, exportFilename, flattenRecord } from "../../utils/admin/exportFile.ts";
import { walkExport } from "../../utils/admin/exportPaging.ts";
import { defaultDateRange, rangeDays, validateRange } from "../../utils/admin/dateRange.ts";

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => (ok ? pass++ : (fail++, console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`)));
const range = (qs) => resolveRange(new URLSearchParams(qs), new Date("2026-10-01T12:00:00Z"));

console.log("1. resolveRange: inclusive UTC days");
{
  const r = range("from=2026-09-01&to=2026-09-07");
  check("week ok", r.ok && r.from.toISOString() === "2026-09-01T00:00:00.000Z" && r.toExclusive.toISOString() === "2026-09-08T00:00:00.000Z");
  const m = range("from=2026-09-01&to=2026-09-30");
  check("month includes the 30th, stops before Oct 1", m.ok && m.toExclusive.toISOString() === "2026-10-01T00:00:00.000Z");
  const d = range("from=2026-09-15&to=2026-09-15");
  check("one day = that whole UTC day", d.ok && d.toExclusive.getTime() - d.from.getTime() === 86_400_000);
  check("historical range accepted", range("from=2024-02-28&to=2024-03-01").ok);
  check("leap day valid", range("from=2024-02-29&to=2024-02-29").ok);
}
console.log("2. resolveRange: invalid input is rejected, never silently defaulted");
{
  check("start after end", range("from=2026-09-07&to=2026-09-01").ok === false);
  check("empty from (cleared field)", range("from=&to=2026-09-07").ok === false);
  check("empty to", range("from=2026-09-01&to=").ok === false);
  check("garbage", range("from=yesterday&to=today").ok === false);
  check("impossible day", range("from=2026-02-30&to=2026-03-02").ok === false);
  check("two-digit year typo", range("from=0026-09-01&to=2026-09-07").ok === true && isValidDateParam("0026-09-01"));
  check("full ISO timestamp (older callers) still accepted", range("from=2026-09-01T00:00:00.000Z&to=2026-09-07T00:00:00.000Z").ok);
  check("no params = default window", range("").ok);
}
console.log("3. Picker validation");
{
  check("valid", validateRange({ from: "2026-09-01", to: "2026-09-07" }) === null);
  check("same day valid", validateRange({ from: "2026-09-01", to: "2026-09-01" }) === null);
  check("start > end", /on or before/.test(validateRange({ from: "2026-09-08", to: "2026-09-07" }) ?? ""));
  check("missing start", /start/i.test(validateRange({ from: "", to: "2026-09-07" }) ?? ""));
  check("missing end", /end/i.test(validateRange({ from: "2026-09-01", to: "" }) ?? ""));
  check("not a date", validateRange({ from: "2026-13-01", to: "2026-09-07" }) !== null);
  check("rangeDays inclusive", rangeDays({ from: "2026-09-01", to: "2026-09-07" }) === 7 && rangeDays({ from: "2026-09-01", to: "2026-09-01" }) === 1);
  const dr = defaultDateRange(7, new Date("2026-09-30T23:59:00Z"));
  check("default range is UTC and 7 days", dr.to === "2026-09-30" && dr.from === "2026-09-24");
}

console.log("4. End-to-end CSV through the route's walk");
const profile = buildAdminProfile({
  adminRow: { user_id: "11111111-1111-1111-1111-111111111111", role: "admin", display_name: null, is_active: true, created_at: "2026-09-22T14:25:00Z", updated_at: "2026-09-22T14:25:00Z" },
  userProfileRow: null,
  authUser: { id: "11111111-1111-1111-1111-111111111111", email: "admin@example.test", phone: "", last_sign_in_at: null, created_at: "2026-09-22T14:20:00Z", updated_at: "2026-09-22T14:20:00Z", user_metadata: {} },
});
const cities = [["NG", "LA", "Lagos"], ["NG", "FC", "Abuja"], ["US", "CA", "San Jose"], ["JP", "13", "Tokyo"]];
// One event at the start, middle and very end of every day from Aug 30 to Oct 2, several places/devices.
const events = [];
let id = 0;
for (let day = 0; day < 34; day++) {
  for (const time of ["00:00:00.000", "12:30:00.000", "23:59:59.999"]) {
    const [country_code, region, city] = cities[id % cities.length];
    const created_at = new Date(Date.parse("2026-08-30T00:00:00Z") + day * 86_400_000).toISOString().slice(0, 11) + time + "Z";
    events.push({ id: ++id, event_name: "page_view", visitor_id: `v${id}`, session_id: `s${id}`, user_id: null, path: "/scan", referrer: null, country_code, region, city, county_district_lga: null, neighborhood_suburb: null, postal_code: null, location_source: "vercel", device_type: id % 2 ? "mobile" : "desktop", browser: "chrome", operating_system: "linux", properties: { note: 'has "quotes", commas\nand newlines' }, created_at });
  }
}
async function exportCsv(qs) {
  const params = new URLSearchParams(qs);
  const r = resolveRange(params);
  if (!r.ok) return { error: r.error };
  const filters = parseFilters(params);
  const PAGE = 25; // small pages: the walk must cross many of them
  const fetchPage = async (dataset, after) => {
    const scanned = events.filter((e) => e.created_at >= r.from.toISOString() && e.created_at < r.toExclusive.toISOString() && e.id > after).slice(0, PAGE);
    return { profile, dataset, rows: scanned.filter((e) => matchesFilters(e, filters)).map((e) => eventToRecord(e, "new")), next_after: scanned.length === PAGE ? scanned[scanned.length - 1].id : null, scanned: scanned.length };
  };
  const columns = exportColumns(profile, "records");
  const first = await fetchPage("events", 0);
  let csv = CSV_BOM + csvHeader(columns);
  for await (const { record, profile: p } of walkExport(fetchPage, ["events"], first)) csv += csvLine(flattenRecord(record, p), columns);
  return { csv, columns, name: exportFilename("csv", "full", params.get("from"), params.get("to")) };
}
// Minimal RFC 4180 parser (quoted fields, doubled quotes, embedded newlines).
function parseCsv(text) {
  const rows = [[""]];
  let q = false;
  for (let i = text.replace(/^﻿/, "").length ? 0 : 0, t = text.replace(/^﻿/, ""); i < t.length; i++) {
    const c = t[i], row = rows[rows.length - 1];
    if (q) { if (c === '"' && t[i + 1] === '"') { row[row.length - 1] += '"'; i++; } else if (c === '"') q = false; else row[row.length - 1] += c; }
    else if (c === '"') q = true;
    else if (c === ",") row.push("");
    else if (c === "\n") rows.push([""]);
    else if (c !== "\r") row[row.length - 1] += c;
  }
  if (rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
fs.mkdirSync(outDir, { recursive: true });
const dates = (parsed, col) => parsed.slice(1).map((r) => r[parsed[0].indexOf(col)]);

{
  const week = await exportCsv("from=2026-09-01&to=2026-09-07");
  fs.writeFileSync(path.join(outDir, week.name), week.csv);
  const rows = parseCsv(week.csv);
  const ts = dates(rows, "occurred_at");
  check("week: file name", week.name === "freepdfscanner-analytics-2026-09-01-to-2026-09-07.csv", week.name);
  check("week: 7 days x 3 events", ts.length === 21, String(ts.length));
  check("week: nothing outside the range", ts.every((t) => t >= "2026-09-01T00:00:00" && t < "2026-09-08T00:00:00"), ts[0]);
  check("week: first/last instants of the range are included", ts.includes("2026-09-01T00:00:00.000Z") && ts.includes("2026-09-07T23:59:59.999Z"));
  check("week: every row has every column (escaping intact)", rows.every((r) => r.length === rows[0].length));
  check("week: embedded quotes/commas/newlines round-trip", rows.slice(1).every((r) => JSON.parse(r[rows[0].indexOf("properties")]).note === 'has "quotes", commas\nand newlines'));
  check("week: no secrets/ip columns", !rows[0].some((c) => /ip_hash|password|secret|token|document/i.test(c)));

  const month = await exportCsv("from=2026-09-01&to=2026-09-30");
  fs.writeFileSync(path.join(outDir, month.name), month.csv);
  const mts = dates(parseCsv(month.csv), "occurred_at");
  check("month: 30 x 3", mts.length === 90 && mts.every((t) => t.startsWith("2026-09-")));

  const one = await exportCsv("from=2026-09-15&to=2026-09-15");
  const ots = dates(parseCsv(one.csv), "occurred_at");
  check("one day: exactly that day", ots.length === 3 && ots.every((t) => t.startsWith("2026-09-15")));

  const filtered = await exportCsv("from=2026-09-01&to=2026-09-30&country=NG&state_province=LA&device=mobile");
  const frows = parseCsv(filtered.csv);
  const cc = frows[0].indexOf("country_code"), st = frows[0].indexOf("state_province"), dv = frows[0].indexOf("device_type");
  check("filters respected inside the range", frows.length > 1 && frows.slice(1).every((r) => r[cc] === "NG" && r[st] === "LA" && r[dv] === "mobile"));
  check("filters + range: nothing outside", dates(frows, "occurred_at").every((t) => t.startsWith("2026-09-")));

  const empty = await exportCsv("from=2031-01-01&to=2031-01-31");
  const erows = parseCsv(empty.csv);
  check("empty range: valid CSV with header only", erows.length === 1 && erows[0].length > 10);

  check("start>end rejected", (await exportCsv("from=2026-09-07&to=2026-09-01")).error === "Invalid date range");
  check("cleared start rejected (no silent 30-day export)", (await exportCsv("from=&to=2026-09-07")).error !== undefined);

  // Adjacent days partition cleanly: no event lost or doubled at midnight.
  const a = dates(parseCsv((await exportCsv("from=2026-09-01&to=2026-09-10")).csv), "occurred_at");
  const b = dates(parseCsv((await exportCsv("from=2026-09-11&to=2026-09-20")).csv), "occurred_at");
  const both = dates(parseCsv((await exportCsv("from=2026-09-01&to=2026-09-20")).csv), "occurred_at");
  check("adjacent ranges partition the union", a.length + b.length === both.length && new Set([...a, ...b]).size === both.length);
}
{
  // Large export: 60k rows stream through the walk with bounded work per page.
  const big = Array.from({ length: 60_000 }, (_, i) => ({ ...events[i % events.length], id: i + 1, created_at: "2026-09-10T10:00:00.000Z" }));
  const PAGE = 1000;
  const fetchPage = async (dataset, after) => {
    const scanned = big.filter((_, i) => i >= after).slice(0, PAGE);
    return { profile, dataset, rows: scanned.map((e) => eventToRecord(e, "new")), next_after: scanned.length === PAGE ? scanned[scanned.length - 1].id : null, scanned: scanned.length };
  };
  let n = 0;
  const first = await fetchPage("events", 0);
  for await (const _ of walkExport(fetchPage, ["events"], first)) n++;
  check("60,000 rows walked page by page, none lost", n === 60_000, String(n));
}

{
  // Later pages omit the profile (read once, on the first page): every record still carries it.
  const pages = [
    { profile, dataset: "events", rows: [1, 2].map((i) => eventToRecord(events[i], "new")), next_after: 2, scanned: 2 },
    { profile: null, dataset: "events", rows: [3, 4].map((i) => eventToRecord(events[i], "new")), next_after: null, scanned: 2 },
  ];
  let i = 0;
  const out = [];
  for await (const x of walkExport(async () => pages[++i], ["events"], pages[0])) out.push(x);
  check("profile-less later pages still yield the first page's profile", out.length === 4 && out.every((x) => x.profile === profile));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
