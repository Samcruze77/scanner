// Runs migration 20261028134500_exclude_admin_traffic_from_reports.sql in a real (in-process) Postgres and
// checks that the dashboard's SQL aggregation leaves out administrator accounts and the browser/session an
// administrator signed in from, keeps guests and customers, is idempotent, and changes no stored rows.
// Needs @electric-sql/pglite, which is NOT a project dependency: install it somewhere (npm i @electric-sql/pglite)
// and run with NODE_PATH pointing at that node_modules, e.g.
//   NODE_PATH=/path/to/node_modules node tests/analytics/admin-exclusion-sql.mjs
// Without it this prints SKIPPED and exits 0 -- count that as "not run".
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(createRequire(import.meta.url).resolve("@electric-sql/pglite")).href));
} catch {
  console.log("SKIPPED: @electric-sql/pglite is not installed");
  process.exit(0);
}
const root = fileURLToPath(new URL("../..", import.meta.url));
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role;");
await db.exec(`
create table public.admin_users (user_id uuid primary key, role text, is_active boolean);
create table public.analytics_events (id bigserial primary key, event_name text, visitor_id text, session_id text, user_id uuid, country_code text, region text, city text, county_district_lga text, neighborhood_suburb text, location_source text, device_type text, browser text, operating_system text, referrer text, created_at timestamptz default now());
create table public.ad_events (id bigserial primary key, event_type text, user_id uuid, session_id text, country_code text, region text, city text, county_district_lga text, neighborhood_suburb text, device_type text, created_at timestamptz default now());
insert into admin_users values ('11111111-1111-4111-8111-111111111111','super_admin',true), ('22222222-2222-4222-8222-222222222222','analyst',false);
insert into analytics_events (event_name, visitor_id, session_id, user_id, created_at) values
 ('page_view','va','sa','11111111-1111-4111-8111-111111111111', now()),   -- administrator, signed in
 ('page_view','va','sa0',null, now()),                                     -- same browser, before sign-in
 ('page_view','vb','sb','22222222-2222-4222-8222-222222222222', now()),   -- inactive analyst still administrator traffic
 ('page_view','vg','sg',null, now()),                                      -- guest
 ('page_view','vc','sc','33333333-3333-4333-8333-333333333333', now()),   -- customer
 ('page_view',null,'sa',null, now()),                                      -- administrator's session, no visitor id
 ('page_view','vold','so',null, now() - interval '40 days');              -- earlier visit by guest (returning)
insert into ad_events (event_type, user_id, session_id, created_at) values
 ('impression','11111111-1111-4111-8111-111111111111',null, now()),
 ('click',null,'sa', now()),                 -- session where the admin was signed in
 ('impression',null,'sg', now()),            -- guest
 ('impression','33333333-3333-4333-8333-333333333333','sc', now());
`);
const mig = readFileSync(root + "/supabase/migrations/20261028134500_exclude_admin_traffic_from_reports.sql", "utf8");
await db.exec(mig);
await db.exec(mig); // idempotent
const q = async (s) => (await db.query(s)).rows;
const ev = (await q(`select public.admin_analytics_event_groups(now() - interval '7 days', now() + interval '1 day') as r`))[0].r;
const ad = (await q(`select public.admin_analytics_ad_groups(now() - interval '7 days', now() + interval '1 day') as r`))[0].r;
console.log("event groups:", ev.map((g) => g.visitor_id).sort().join(","), "| total events", ev.reduce((s, g) => s + g.n, 0));
console.log("ad groups:", ad.map((g) => `${g.event_type}:${g.n}`).sort().join(","));
const tables = await q(`select (select count(*) from analytics_events)::int events, (select count(*) from ad_events)::int ads`);
console.log("rows untouched:", JSON.stringify(tables[0]));
const ok = JSON.stringify(ev.map((g) => g.visitor_id).sort()) === JSON.stringify(["vc", "vg"]) && ad.map((g) => `${g.event_type}:${g.n}`).sort().join(",") === "impression:2" && ev.reduce((sum, g) => sum + g.n, 0) === 2 && tables[0].events === 7 && tables[0].ads === 4;
console.log(ok ? "SQL CHECK PASS" : "SQL CHECK FAIL");
process.exit(ok ? 0 : 1);
