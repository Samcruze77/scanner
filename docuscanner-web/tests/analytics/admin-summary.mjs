// The dashboard/geography summary must be identical whether it is computed from every raw event or from the
// SQL-collapsed rows (admin_analytics_event_groups: one row per distinct combination with a count `n`).
// Pure functions, deterministic data, no network.
//
// Run: node tests/analytics/admin-summary.mjs

import assert from "node:assert/strict";
import { buildAdminSummary } from "../../supabase/functions/_shared/adminSummary.ts";
import { weightOf } from "../../supabase/functions/_shared/geoHierarchy.ts";

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => (ok ? pass++ : (fail++, console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`)));

// Deterministic PRNG so the test is reproducible.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const PLACES = [
  ["NG", "LA", "Lagos", null, null], ["NG", "LA", "Lagos", "Ikeja", null], ["NG", "RI", "Port Harcourt", null, null],
  ["US", "CA", "San Jose", null, null], ["US", "TX", "Springfield", null, null], ["US", "IL", "Springfield", null, null],
  ["GB", "ENG", "London", "Camden", "Kentish Town"], ["JP", "13", "Tokyo", null, null], ["BR", "SP", "São Paulo", null, null],
  ["KE", null, null, null, null], [null, null, null, null, null],
];
const EVENTS = ["page_view", "page_view", "page_view", "app_open", "scan_started", "scan_completed", "conversion_completed", "document_downloaded", "signup_completed", "feature_used"];
const raw = [];
for (let s = 0; s < 400; s++) {
  const [cc, rg, ct, dist, nb] = pick(PLACES);
  const visitor = rnd() < 0.05 ? null : `v${Math.floor(s / 2)}`;
  const base = {
    visitor_id: visitor, session_id: rnd() < 0.03 ? null : `s${s}`, user_id: rnd() < 0.1 ? `u${s % 7}` : null,
    country_code: cc, region: rg, city: ct, county_district_lga: dist, neighborhood_suburb: nb, location_source: cc ? pick(["vercel", "vercel+ip2location"]) : null,
    device_type: pick(["desktop", "mobile", "tablet", null]), browser: pick(["chrome", "safari", null]), operating_system: pick(["windows", "ios"]),
    referrer: pick(["https://google.com/", null]),
    created_at: `2026-09-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
  };
  for (let e = 0; e < 1 + Math.floor(rnd() * 14); e++) raw.push({ ...base, event_name: pick(EVENTS) });
}
const ads = Array.from({ length: 300 }, () => {
  const [cc, rg, ct, dist, nb] = pick(PLACES);
  return { event_type: rnd() < 0.1 ? "click" : "impression", country_code: cc, region: rg, city: ct, county_district_lga: dist, neighborhood_suburb: nb, device_type: pick(["desktop", "mobile"]), created_at: `2026-09-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}` };
});
const returning = new Set(raw.filter((r) => r.visitor_id && Number(r.visitor_id.slice(1)) % 3 === 0).map((r) => r.visitor_id));

// Collapse exactly the way the SQL function groups.
function collapse(rows) {
  const m = new Map();
  for (const r of rows) {
    const { n: _n, ...rest } = r;
    const key = JSON.stringify(rest);
    const g = m.get(key);
    if (g) g.n += 1;
    else m.set(key, { ...rest, n: 1 });
  }
  return [...m.values()];
}
const groups = collapse(raw);
const adGroups = collapse(ads);
check("collapsing actually reduces rows", groups.length < raw.length, `${groups.length} vs ${raw.length}`);
check("weights add back up", groups.reduce((t, g) => t + weightOf(g), 0) === raw.length && adGroups.reduce((t, g) => t + weightOf(g), 0) === ads.length);

const a = buildAdminSummary(raw, ads, returning);
const b = buildAdminSummary(groups, adGroups, returning);
for (const key of Object.keys(a)) {
  let same = true;
  try { assert.deepEqual(b[key], a[key]); } catch { same = false; }
  check(`summary.${key} identical from collapsed rows`, same);
}
check("overview has real numbers", a.overview.page_views > 100 && a.overview.unique_visitors > 100 && a.overview.ad_impressions > 200);
check("coverage counts events, not groups", b.geo_coverage.events === raw.length);
check("neighborhood only where the data had one", b.geo_coverage.neighborhood_suburb === raw.filter((r) => r.neighborhood_suburb).length);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
