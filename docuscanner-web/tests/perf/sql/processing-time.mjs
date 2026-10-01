// Server-side (JS) cost of building the summary from raw rows vs SQL-collapsed rows. Needs the seeded local db.
import { execFileSync } from "node:child_process";
import { buildAdminSummary } from "../../../supabase/functions/_shared/adminSummary.ts";
const q = (sql) => execFileSync("psql", ["-h", process.env.PGHOST ?? "/tmp", "-p", process.env.PGPORT ?? "5544", "-U", "postgres", "-d", "adm", "-qAt", "-c", sql], { maxBuffer: 1 << 30 }).toString().trim();
const W = "created_at >= now() - interval '30 days'";
const groupsText = q(`select admin_analytics_event_groups(now() - interval '30 days', now() + interval '1 day')`);
const rawText = q(`select json_agg(json_build_object('created_at', created_at::text, 'event_name', event_name, 'visitor_id', visitor_id, 'session_id', session_id, 'user_id', user_id, 'country_code', country_code, 'region', region, 'city', city, 'county_district_lga', county_district_lga, 'neighborhood_suburb', neighborhood_suburb, 'device_type', device_type, 'browser', browser, 'operating_system', operating_system, 'referrer', referrer, 'properties', properties)) from analytics_events where ${W}`);
const time = (label, text) => {
  const runs = [];
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    const rows = JSON.parse(text);
    const t1 = performance.now();
    buildAdminSummary(rows, [], new Set());
    runs.push([t1 - t0, performance.now() - t1]);
  }
  runs.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const [parse, agg] = runs[3];
  console.log(`${label}: payload ${(text.length / 1e6).toFixed(2)} MB, rows ${JSON.parse(text).length}, JSON.parse ${parse.toFixed(0)} ms, aggregate ${agg.toFixed(0)} ms (median of 7)`);
};
time("legacy raw rows   ", rawText);
time("collapsed groups  ", groupsText);
