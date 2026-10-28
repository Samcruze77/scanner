// Administrator traffic is excluded from visitor analytics at the SERVER. Runs the real deployed
// handlers (track-analytics, heartbeat, track-ad-event, admin-analytics, admin-live) against an
// in-memory fake of the Supabase admin client; only the `npm:` imports are stubbed.
//
// Proves: an administrator generates no analytics event / presence row / ad event; ordinary
// visitors and signed-in non-administrators are still recorded; a client cannot change the outcome
// with a fabricated role/flag; reports leave out administrator traffic (by account and by the browser
// an administrator signed in from) while keeping everyone else's; administrator actions stay in the
// audit logs.
//
// Run: node --no-warnings --import ./tests/scanner/register.mjs tests/analytics/admin-exclusion.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EMPTY_ADMIN_TRAFFIC, clearAdminCache, isAdminTraffic, isAdminUser, loadAdminTraffic } from "../../supabase/functions/_shared/adminTraffic.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FN = path.join(here, "..", "..", "supabase", "functions");

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, "\n  ", e.message);
  }
}

// ---- fake database -------------------------------------------------------------------------------------------
const ADMIN = "11111111-1111-4111-8111-111111111111"; // super_admin
const ANALYST = "22222222-2222-4222-8222-222222222222"; // analyst (also an administrator role)
const CUSTOMER = "33333333-3333-4333-8333-333333333333"; // ordinary signed-in customer

function makeDb(seed = {}) {
  const tables = {
    admin_users: [
      { user_id: ADMIN, role: "super_admin", is_active: true },
      { user_id: ANALYST, role: "analyst", is_active: true },
    ],
    analytics_events: [],
    live_sessions: [],
    ad_events: [],
    ad_creatives: [{ id: "c0000000-0000-4000-8000-000000000001", campaign_id: "a0000000-0000-4000-8000-000000000001", slot_code: "top" }],
    ad_campaigns: [{ id: "a0000000-0000-4000-8000-000000000001", status: "active", name: "Camp" }],
    user_profiles: [],
    admin_audit_logs: [],
    ...seed,
  };
  const reads = [];
  function from(name) {
    let rows = tables[name];
    const filters = [];
    let mode = "select";
    let patch = null;
    const q = {
      select() { return q; },
      insert(payload) { mode = "insert"; (Array.isArray(payload) ? payload : [payload]).forEach((r) => tables[name].push({ ...r })); return q; },
      update(p) { mode = "update"; patch = p; return q; },
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
      not(c, op, v) { if (op === "is" && v === null) filters.push((r) => r[c] !== null && r[c] !== undefined); return q; },
      gte(c, v) { filters.push((r) => r[c] >= v); return q; },
      lt(c, v) { filters.push((r) => r[c] < v); return q; },
      gt(c, v) { filters.push((r) => r[c] > v); return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: mode === "insert" ? null : run(), error: null }).then(res, rej); },
    };
    function run() {
      reads.push(name);
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") for (const r of matched) Object.assign(r, patch);
      return matched;
    }
    return q;
  }
  return { tables, reads, client: { from, rpc: async () => ({ data: null, error: { message: "not installed" } }), auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } } } };
}

// ---- load real handlers with platform wrapper + supabase-js stubbed --------------------------------------------
const ctxHolder = { current: null };
globalThis.__withSupabase = (_opts, handler) => (req) => handler(req, ctxHolder.current);
globalThis.__createClient = () => ctxHolder.current.supabaseAdmin;
globalThis.Deno = { env: { get: () => "test" } }; // admin-live builds its own client from Deno.env
async function load(name) {
  const src = fs
    .readFileSync(path.join(FN, name, "index.ts"), "utf8")
    .replace('import { withSupabase } from "npm:@supabase/server"', "const withSupabase = globalThis.__withSupabase")
    .replace('import { createClient } from "npm:@supabase/supabase-js@2"', "const createClient = globalThis.__createClient");
  const tmp = path.join(FN, name, "_test_index.ts");
  fs.writeFileSync(tmp, src);
  try {
    return (await import(pathToFileURL(tmp).href + `?${Math.random()}`)).default.fetch;
  } finally {
    fs.unlinkSync(tmp);
  }
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const post = (body, ua = IPHONE) => new Request("https://x.test/fn", { method: "POST", headers: { "content-type": "application/json", "user-agent": ua }, body: JSON.stringify(body) });
const get = (qs = "") => new Request(`https://x.test/fn${qs}`, { method: "GET" });
const useDb = (db, userClaims) => { ctxHolder.current = { supabaseAdmin: db.client, userClaims }; clearAdminCache(); };

const track = await load("track-analytics");
const heartbeat = await load("heartbeat");
const adEvent = await load("track-ad-event");
const adminAnalytics = await load("admin-analytics");
const adminLive = await load("admin-live");

const view = (extra = {}) => ({ event_name: "page_view", visitor_id: "v-guest", session_id: "s-guest", path: "/scan", ...extra });

// ---- ingestion ------------------------------------------------------------------------------------------------
await check("an administrator (super_admin) generates no analytics event", async () => {
  const db = makeDb(); useDb(db);
  const res = await track(post(view({ user_id: ADMIN, visitor_id: "v-admin", session_id: "s-admin" })));
  assert.equal(res.status, 202);
  assert.equal(db.tables.analytics_events.length, 0);
});
await check("every administrator role is excluded (analyst too)", async () => {
  const db = makeDb(); useDb(db);
  await track(post(view({ user_id: ANALYST })));
  assert.equal(db.tables.analytics_events.length, 0);
});
await check("a normal visitor (guest) is still tracked, with device/OS from the visitor's user agent", async () => {
  const db = makeDb(); useDb(db);
  const res = await track(post(view()));
  assert.equal(res.status, 202);
  assert.equal(db.tables.analytics_events.length, 1);
  assert.equal(db.tables.analytics_events[0].device_type, "mobile");
  assert.equal(db.tables.analytics_events[0].user_id, null);
});
await check("a normal signed-in customer is still tracked, with their user id", async () => {
  const db = makeDb(); useDb(db);
  await track(post(view({ user_id: CUSTOMER, visitor_id: "v-cust", session_id: "s-cust" })));
  assert.equal(db.tables.analytics_events.length, 1);
  assert.equal(db.tables.analytics_events[0].user_id, CUSTOMER);
});
await check("fabricated role / admin flags from a client change nothing", async () => {
  // An administrator claiming not to be one is still excluded; a customer claiming to be one is still recorded.
  const db = makeDb(); useDb(db);
  await track(post(view({ user_id: ADMIN, is_admin: false, role: "user", exclude: false, isAdmin: false })));
  assert.equal(db.tables.analytics_events.length, 0, "administrator escaped by sending is_admin:false");
  await track(post(view({ user_id: CUSTOMER, is_admin: true, role: "super_admin", exclude: true, isAdmin: true, visitor_id: "v-c2", session_id: "s-c2" })));
  assert.equal(db.tables.analytics_events.length, 1, "customer was dropped because of a client-supplied flag");
});
await check("the proxy takes the user id from the verified session, never from the request body", async () => {
  for (const slug of ["track", "heartbeat", "ad-event"]) {
    const src = fs.readFileSync(path.join(here, "..", "..", "app", "api", "analytics", slug, "route.ts"), "utf8");
    assert.ok(/user_id: userId/.test(src), `${slug}: user_id must come from resolveUserId()`);
    assert.ok(!/body\.user_id|body\.is_admin|body\.role|body\.isAdmin/.test(src), `${slug}: must not read a user id or role from the body`);
  }
});
await check("an administrator is not counted as a live visitor (no presence row); a customer and a guest are", async () => {
  const db = makeDb(); useDb(db);
  await heartbeat(post({ session_id: "s-admin", visitor_id: "v-admin", path: "/", user_id: ADMIN }));
  assert.equal(db.tables.live_sessions.length, 0);
  await heartbeat(post({ session_id: "s-c", visitor_id: "v-c", path: "/", user_id: CUSTOMER }));
  await heartbeat(post({ session_id: "s-g", visitor_id: "v-g", path: "/" }));
  assert.equal(db.tables.live_sessions.length, 2);
  for (const r of db.tables.live_sessions) assert.equal(r.started_at, r.last_seen, "new session rows are stamped with one timestamp (no clock skew)");
});
await check("administrator ad impressions/clicks are not recorded; visitor and customer ones are", async () => {
  const db = makeDb(); useDb(db);
  const ev = (extra) => post({ campaign_id: "a0000000-0000-4000-8000-000000000001", creative_id: "c0000000-0000-4000-8000-000000000001", event_type: "impression", path: "/", ...extra });
  await adEvent(ev({ user_id: ADMIN }));
  await adEvent(ev({ user_id: ANALYST, event_type: "click" }));
  assert.equal(db.tables.ad_events.length, 0);
  await adEvent(ev({}));
  await adEvent(ev({ user_id: CUSTOMER, event_type: "click" }));
  assert.equal(db.tables.ad_events.length, 2);
});
await check("guests never trigger an admin lookup; the lookup is cached; a failing lookup keeps the event", async () => {
  const db = makeDb(); useDb(db);
  assert.equal(await isAdminUser(db.client, null), false);
  assert.equal(db.reads.length, 0);
  assert.equal(await isAdminUser(db.client, ADMIN), true);
  await isAdminUser(db.client, ADMIN);
  assert.equal(db.reads.length, 1, "second call should be cached");
  const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "down" } }) }) }) }) };
  clearAdminCache();
  assert.equal(await isAdminUser(broken, CUSTOMER), false);
});

// ---- reporting ------------------------------------------------------------------------------------------------
const day = "2026-10-20T10:00:00.000Z";
const group = (o) => ({ created_at: day.slice(0, 10), event_name: "page_view", country_code: "NG", region: "LA", city: "Lagos", county_district_lga: null, neighborhood_suburb: null, location_source: "vercel", device_type: "desktop", browser: "chrome", operating_system: "windows", referrer: null, n: 1, returning: false, user_id: null, ...o });
const reportDb = () =>
  makeDb({
    analytics_events: [
      { id: 1, visitor_id: "v-admin", user_id: ADMIN, session_id: "s1", created_at: day }, // admin signed in from browser v-admin
    ],
    live_sessions: [
      { session_id: "s-admin", visitor_id: "v-admin", user_id: ADMIN, path: "/admin", last_seen: new Date().toISOString(), started_at: new Date(Date.now() - 60000).toISOString() },
      { session_id: "s-guest", visitor_id: "v-guest", user_id: null, path: "/scan", last_seen: new Date().toISOString(), started_at: new Date(Date.now() - 120000).toISOString() },
      { session_id: "s-cust", visitor_id: "v-cust", user_id: CUSTOMER, path: "/", last_seen: new Date().toISOString(), started_at: new Date(Date.now() - 90000).toISOString() },
    ],
  });
// The dashboard's fast path leaves administrators out inside SQL (migration 20261029090000, verified against a
// real Postgres in tests/analytics/admin-exclusion-sql.mjs). This exercises the real handler's fallback path,
// which reads the raw tables and applies the same rule in code.
const ev = (id, o) => ({ id, event_name: "page_view", visitor_id: null, session_id: null, user_id: null, country_code: "NG", region: "LA", city: "Lagos", county_district_lga: null, neighborhood_suburb: null, location_source: "vercel", device_type: "desktop", browser: "chrome", operating_system: "windows", referrer: null, properties: {}, created_at: day, ...o });
await check("dashboard (raw-table path) leaves out administrator accounts AND the browser they signed in from, keeps everyone else", async () => {
  const db = reportDb();
  db.tables.analytics_events = [
    ev(1, { visitor_id: "v-admin", session_id: "s1", user_id: ADMIN }), // the administrator, signed in
    ev(2, { visitor_id: "v-admin", session_id: "s0" }), // same browser, before signing in (pre-login testing)
    ev(3, { visitor_id: "v-guest", session_id: "s-guest" }), // ordinary visitor
    ev(4, { visitor_id: "v-cust", session_id: "s-cust", user_id: CUSTOMER }), // signed-in customer
    ev(5, { visitor_id: "v-other", session_id: "s-other", device_type: "mobile" }),
  ];
  db.tables.ad_events = [
    { id: 1, event_type: "impression", user_id: ADMIN, country_code: "NG", device_type: "desktop", created_at: day },
    { id: 2, event_type: "impression", user_id: null, country_code: "NG", device_type: "desktop", created_at: day },
  ];
  db.client.rpc = async (fn) => (fn === "returning_visitor_ids" ? { data: [], error: null } : { data: null, error: { message: "not installed" } });
  useDb(db, { id: ADMIN });
  const res = await adminAnalytics(get("?from=2026-10-01&to=2026-10-28"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.overview.unique_visitors, 3, "v-guest, v-cust and v-other only");
  assert.equal(body.overview.sessions, 3);
  assert.equal(body.overview.page_views, 3);
  assert.equal(body.overview.ad_impressions, 1, "the administrator's ad impression is not counted; the visitor's is");
  assert.equal(body.geo.countries.reduce((s, c) => s + c.users, 0), 3, "geography counts the same 3 visitors");
  const mobile = body.breakdowns.devices.find((d) => (d.key ?? d.label) === "mobile");
  assert.ok(mobile, "device breakdown still reports the mobile visitor");
});
await check("live view: administrators are not counted or listed; guests and customers are", async () => {
  const db = reportDb(); useDb(db, { id: ADMIN });
  const res = await adminLive(get());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.sessions.map((s) => s.session_id).sort(), ["s-cust", "s-guest"]);
  assert.equal(body.online_count, 2);
});
await check("historical attribution: user_id and browser linkage, and nothing for browsers never linked", async () => {
  const db = reportDb();
  const t = await loadAdminTraffic(db.client);
  assert.ok(t.userIds.has(ADMIN) && t.userIds.has(ANALYST));
  assert.ok(t.visitorIds.has("v-admin"));
  assert.equal(isAdminTraffic(t, { user_id: null, visitor_id: "v-admin" }), true);
  assert.equal(isAdminTraffic(t, { user_id: null, visitor_id: "v-never-signed-in-admin" }), false, "cannot be linked: identity was never recorded");
  assert.equal(isAdminTraffic(EMPTY_ADMIN_TRAFFIC, { user_id: ADMIN }), false);
});
await check("administrator actions stay in the audit logs (exclusion never touches them)", async () => {
  for (const file of ["admin-ads/index.ts", "admin-users/index.ts", "admin-analytics-export/index.ts"]) {
    assert.ok(fs.readFileSync(path.join(FN, file), "utf8").includes('"admin_audit_logs"'), `${file} must still write audit rows`);
  }
  for (const file of ["_shared/adminTraffic.ts", "track-analytics/index.ts", "heartbeat/index.ts", "track-ad-event/index.ts"]) {
    assert.ok(!fs.readFileSync(path.join(FN, file), "utf8").replace(/\/\/.*$/gm, "").includes("admin_audit_logs"), `${file} must not reference the audit log`);
  }
  const mig = fs.readFileSync(path.join(here, "..", "..", "supabase", "migrations", "20261029090000_exclude_admin_traffic_from_reports.sql"), "utf8").replace(/--.*$/gm, "");
  assert.ok(!/admin_audit_logs/.test(mig) && !/\bdelete\b|\btruncate\b|\bupdate\s+public\./i.test(mig), "migration must neither read audit logs nor change/delete rows");
});

process.exit(failed ? 1 : 0);
