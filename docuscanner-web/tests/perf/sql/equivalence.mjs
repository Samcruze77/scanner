// Verifies the SQL functions against ground truth computed by plain SQL on the same rows, and the full
// summary built from the collapsed rows against the summary built from every raw row.
//   PGPORT=5544 PGHOST=/tmp node tests/perf/sql/equivalence.mjs   (database with the migration + seed applied)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildAdminSummary } from "../../../supabase/functions/_shared/adminSummary.ts";

const q = (sql) => execFileSync("psql", ["-h", process.env.PGHOST ?? "/tmp", "-p", process.env.PGPORT ?? "5544", "-U", "postgres", "-d", "adm", "-qAt", "-c", sql], { maxBuffer: 1 << 30 }).toString().trim();
const FROM = "now() - interval '30 days'";
const TO = "now() + interval '1 day'";
let pass = 0, fail = 0;
const check = (name, ok, detail) => (ok ? pass++ : (fail++, console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`)));

const groups = JSON.parse(q(`select admin_analytics_event_groups(${FROM}, ${TO})`));
const adGroups = JSON.parse(q(`select admin_analytics_ad_groups(${FROM}, ${TO})`));
const raw = JSON.parse(q(`select coalesce(json_agg(json_build_object('created_at', (created_at at time zone 'utc')::date::text, 'event_name', event_name, 'visitor_id', visitor_id, 'session_id', session_id, 'user_id', user_id, 'country_code', country_code, 'region', region, 'city', city, 'county_district_lga', county_district_lga, 'neighborhood_suburb', neighborhood_suburb, 'location_source', location_source, 'device_type', device_type, 'browser', browser, 'operating_system', operating_system, 'referrer', referrer)), '[]') from analytics_events where created_at >= ${FROM} and created_at < ${TO}`));
const rawAds = JSON.parse(q(`select coalesce(json_agg(json_build_object('created_at', (created_at at time zone 'utc')::date::text, 'event_type', event_type, 'country_code', country_code, 'region', region, 'city', city, 'county_district_lga', county_district_lga, 'neighborhood_suburb', neighborhood_suburb, 'device_type', device_type)), '[]') from ad_events where created_at >= ${FROM} and created_at < ${TO}`));
const returningSql = new Set(q(`select distinct visitor_id from analytics_events e where created_at >= ${FROM} and created_at < ${TO} and exists (select 1 from analytics_events p where p.visitor_id = e.visitor_id and p.created_at < ${FROM})`).split("\n").filter(Boolean));
const returningFn = new Set(groups.filter((g) => g.returning).map((g) => g.visitor_id));

check("groups < raw rows", groups.length < raw.length, `${groups.length} vs ${raw.length}`);
check("sum(n) = event count", groups.reduce((t, g) => t + g.n, 0) === Number(q(`select count(*) from analytics_events where created_at >= ${FROM} and created_at < ${TO}`)));
check("ad sum(n) = ad count", adGroups.reduce((t, g) => t + g.n, 0) === rawAds.length);
check("returning visitors match plain SQL", returningSql.size === returningFn.size && [...returningSql].every((v) => returningFn.has(v)), `${returningSql.size} vs ${returningFn.size}`);

const fromGroups = buildAdminSummary(groups, adGroups, returningFn);
const fromRaw = buildAdminSummary(raw, rawAds, returningSql);
for (const k of Object.keys(fromRaw)) {
  let same = true;
  try { assert.deepEqual(fromGroups[k], fromRaw[k]); } catch { same = false; }
  check(`summary.${k} equal`, same);
}
const o = fromGroups.overview;
check("page_views = SQL count", o.page_views === Number(q(`select count(*) from analytics_events where event_name='page_view' and created_at >= ${FROM} and created_at < ${TO}`)));
check("unique_visitors = SQL count distinct", o.unique_visitors === Number(q(`select count(distinct visitor_id) from analytics_events where created_at >= ${FROM} and created_at < ${TO}`)));
check("sessions = SQL count distinct", o.sessions === Number(q(`select count(distinct session_id) from analytics_events where created_at >= ${FROM} and created_at < ${TO}`)));

// Export page: keyset paging with the SQL function covers every row once, in id order, is_returning resolved.
let after = 0, seen = 0, lastId = 0, ret = 0, pages = 0;
for (;;) {
  const page = JSON.parse(q(`select admin_export_events_page(${FROM}, ${TO}, ${after}, 5000)`));
  pages++;
  for (const r of page.rows) { assert.ok(r.id > lastId); lastId = r.id; seen++; if (r.is_returning) ret++; }
  if (page.scanned < 5000) break;
  after = page.last_id;
}
check("export pages cover every row once", seen === raw.length, `${seen} vs ${raw.length}`);
check("export is_returning matches", ret === raw.filter((r) => returningSql.has(r.visitor_id)).length);
const ng = JSON.parse(q(`select admin_export_events_page(${FROM}, ${TO}, 0, 5000, null, 'NG', 'LA', 'Lagos')`));
check("export filter pushdown", ng.rows.length > 0 && ng.rows.every((r) => r.country_code === "NG" && r.region === "LA" && r.city === "Lagos"));
const tricky = JSON.parse(q(`select admin_export_events_page(${FROM}, ${TO}, 0, 5000, null, $$x' or '1'='1$$)`));
check("filter values are quoted, not injected", tricky.rows.length === 0);
console.log(`${pass} passed, ${fail} failed (${pages} export pages)`);
process.exit(fail ? 1 : 0);
