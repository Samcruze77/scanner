// Runs the REAL admin-analytics and admin-analytics-export handlers (the files that are deployed) against an
// in-memory fake of the Supabase admin client, to prove:
//   * with the SQL functions installed, the dashboard answer equals the previous (paged) implementation's
//   * with the SQL functions missing (rpc error), both handlers fall back to the previous implementation and
//     return identical, complete data -- never partial or corrupted data
//   * the fake enforces PostgREST's 1000-row response cap, so a fallback that forgot to page would be caught
//   * unauthenticated / non-admin / analyst callers are rejected, and bad ranges give 400
//   * export paging: large pages with the SQL function, 1000-row pages in fallback, same rows either way
// The only edit made to the handler source is replacing the `npm:@supabase/server` import with a stub that
// hands the handler a prepared context.   Run: node tests/analytics/edge-handlers.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FN = path.join(here, "..", "..", "supabase", "functions");

let pass = 0, fail = 0;
const check = (name, ok, detail) => (ok ? pass++ : (fail++, console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`)));

// --- load a handler with the platform wrapper stubbed -------------------------------------------------------
const ctxHolder = { current: null };
globalThis.__withSupabase = (_opts, handler) => (req) => handler(req, ctxHolder.current);
async function load(name) {
  const src = fs.readFileSync(path.join(FN, name, "index.ts"), "utf8").replace('import { withSupabase } from "npm:@supabase/server"', "const withSupabase = globalThis.__withSupabase");
  const tmp = path.join(FN, name, "_test_index.ts");
  fs.writeFileSync(tmp, src);
  try {
    return (await import(pathToFileURL(tmp).href + `?${Math.random()}`)).default.fetch;
  } finally {
    fs.unlinkSync(tmp);
  }
}

// --- dataset -----------------------------------------------------------------------------------------------------
let seed = 99;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const PLACES = [["NG", "LA", "Lagos"], ["NG", "RI", "Port Harcourt"], ["US", "CA", "San Jose"], ["IN", "MH", "Mumbai"], ["GB", "ENG", "London"], [null, null, null]];
const EVENTS = ["page_view", "page_view", "page_view", "app_open", "scan_started", "scan_completed", "document_downloaded", "feature_used"];
const events = [];
let id = 0;
for (let s = 0; s < 1200; s++) {
  const [cc, rg, ct] = pick(PLACES);
  const day = 1 + Math.floor(rnd() * 28);
  const base = { visitor_id: `v${Math.floor(s / 2)}`, session_id: `s${s}`, user_id: null, path: "/scan", referrer: pick(["https://google.com/", null]), country_code: cc, region: rg, city: ct, county_district_lga: null, neighborhood_suburb: null, postal_code: null, location_source: cc ? "vercel" : null, device_type: pick(["desktop", "mobile"]), browser: "chrome", operating_system: "linux", properties: {} };
  for (let e = 0; e < 1 + Math.floor(rnd() * 12); e++) {
    events.push({ ...base, id: ++id, event_name: pick(EVENTS), created_at: `2026-09-${String(day).padStart(2, "0")}T${String(Math.floor(rnd() * 24)).padStart(2, "0")}:00:00.000Z` });
  }
}
events.sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).forEach((e, i) => (e.id = i + 1)); // ids ascend with time, like real inserts
const ads = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, event_type: i % 10 ? "impression" : "click", campaign_id: null, creative_id: null, slot_code: "top", session_id: null, user_id: null, path: "/", country_code: "NG", region: "LA", city: "Lagos", county_district_lga: null, neighborhood_suburb: null, postal_code: null, location_source: "vercel", device_type: "desktop", created_at: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z` }));
check("dataset is bigger than one PostgREST page", events.length > 2500, String(events.length));

// --- fake supabase admin client ------------------------------------------------------------------------------------
function makeAdmin({ rpcInstalled, role = "admin", active = true, counters }) {
  const day = (iso) => iso.slice(0, 10);
  const groupRows = (from, to) => {
    const win = events.filter((e) => e.created_at >= from && e.created_at < to);
    const prior = new Set(events.filter((e) => e.created_at < from).map((e) => e.visitor_id));
    const m = new Map();
    for (const e of win) {
      const k = JSON.stringify([day(e.created_at), e.event_name, e.visitor_id, e.session_id, e.user_id, e.country_code, e.region, e.city, e.county_district_lga, e.neighborhood_suburb, e.location_source, e.device_type, e.browser, e.operating_system, e.referrer]);
      const g = m.get(k);
      if (g) g.n++;
      else m.set(k, { created_at: day(e.created_at), event_name: e.event_name, visitor_id: e.visitor_id, session_id: e.session_id, user_id: e.user_id, country_code: e.country_code, region: e.region, city: e.city, county_district_lga: e.county_district_lga, neighborhood_suburb: e.neighborhood_suburb, location_source: e.location_source, device_type: e.device_type, browser: e.browser, operating_system: e.operating_system, referrer: e.referrer, n: 1, returning: prior.has(e.visitor_id) });
    }
    return [...m.values()];
  };
  const adGroups = (from, to) => {
    const m = new Map();
    for (const a of ads.filter((x) => x.created_at >= from && x.created_at < to)) {
      const k = JSON.stringify([day(a.created_at), a.event_type, a.country_code, a.region, a.city, a.device_type]);
      const g = m.get(k);
      if (g) g.n++;
      else m.set(k, { created_at: day(a.created_at), event_type: a.event_type, country_code: a.country_code, region: a.region, city: a.city, county_district_lga: null, neighborhood_suburb: null, device_type: a.device_type, n: 1 });
    }
    return [...m.values()];
  };

  // Minimal PostgREST-like query builder over an in-memory table (enforces the 1000-row cap).
  const table = (rows) => {
    const q = { rows: [...rows], filters: [], lim: Infinity, isSingle: false, inserted: null };
    const api = {
      select: () => api,
      eq: (c, v) => (q.rows = q.rows.filter((r) => r[c] === v), api),
      in: (c, vs) => (q.rows = q.rows.filter((r) => vs.includes(r[c])), api),
      gte: (c, v) => (q.rows = q.rows.filter((r) => r[c] >= v), api),
      lt: (c, v) => (q.rows = q.rows.filter((r) => r[c] < v), api),
      gt: (c, v) => (q.rows = q.rows.filter((r) => r[c] > v), api),
      order: (c) => (q.rows.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0)), api),
      limit: (n) => ((q.lim = n), api),
      maybeSingle: () => Promise.resolve({ data: q.rows[0] ?? null, error: null }),
      insert: () => Promise.resolve({ error: null }),
      then: (resolve) => {
        counters.requests++;
        const out = q.rows.slice(0, Math.min(q.lim, 1000));
        counters.maxReturned = Math.max(counters.maxReturned, out.length);
        return Promise.resolve({ data: out, error: null }).then(resolve);
      },
    };
    return api;
  };
  const tables = {
    admin_users: () => table([{ user_id: "u1", role, is_active: active, display_name: null, created_at: "2026-09-22T00:00:00Z", updated_at: "2026-09-22T00:00:00Z" }]),
    user_profiles: () => table([]),
    analytics_events: () => table(events),
    ad_events: () => table(ads),
    ad_campaigns: () => table([]),
    ad_creatives: () => table([]),
    admin_audit_logs: () => table([]),
  };
  return {
    from: (t) => tables[t](),
    auth: { admin: { getUserById: async () => ({ data: { user: { id: "u1", email: "admin@example.test" } } }) } },
    rpc: async (name, args) => {
      counters.rpc++;
      counters.rpcNames.push(name);
      if (name === "returning_visitor_ids") {
        const prior = new Set(events.filter((e) => e.created_at < args.before).map((e) => e.visitor_id));
        return { data: args.visitor_ids.filter((v) => prior.has(v)).map((visitor_id) => ({ visitor_id })), error: null };
      }
      if (!rpcInstalled) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } };
      if (name === "admin_analytics_event_groups") return { data: groupRows(args.p_from, args.p_to), error: null };
      if (name === "admin_analytics_ad_groups") return { data: adGroups(args.p_from, args.p_to), error: null };
      if (name === "admin_export_events_page") {
        const prior = new Set(events.filter((e) => e.created_at < args.p_from).map((e) => e.visitor_id));
        let rows = events.filter((e) => e.created_at >= args.p_from && e.created_at < args.p_to && e.id > args.p_after);
        if (args.p_event_names) rows = rows.filter((e) => args.p_event_names.includes(e.event_name));
        if (args.p_country) rows = rows.filter((e) => e.country_code === args.p_country);
        if (args.p_region) rows = rows.filter((e) => e.region === args.p_region);
        if (args.p_city) rows = rows.filter((e) => e.city === args.p_city);
        if (args.p_device) rows = rows.filter((e) => e.device_type === args.p_device);
        rows = rows.slice(0, Math.min(Math.max(args.p_limit, 1), 5000));
        return { data: { scanned: rows.length, last_id: rows.at(-1)?.id ?? null, rows: rows.map((e) => ({ ...e, is_returning: prior.has(e.visitor_id) })) }, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };
}
const newCounters = () => ({ requests: 0, rpc: 0, rpcNames: [], maxReturned: 0 });
const call = async (handler, qs, { installed, userId = "u1", role = "admin", active = true, method = "GET" }) => {
  const counters = newCounters();
  ctxHolder.current = { userClaims: userId ? { id: userId } : null, supabaseAdmin: makeAdmin({ rpcInstalled: installed, role, active, counters }) };
  const res = await handler(new Request(`https://x.test/functions/v1/fn?${qs}`, { method }));
  return { status: res.status, body: await res.json().catch(() => null), counters };
};

const analytics = await load("admin-analytics");
const exporter = await load("admin-analytics-export");

// --- dashboard: SQL path == fallback path -------------------------------------------------------------------------
for (const qs of ["from=2026-09-24&to=2026-09-30", "from=2026-09-01&to=2026-09-30", "from=2026-09-10&to=2026-09-10", "from=2026-09-01&to=2026-09-30&country=NG&state_province=LA&device=mobile", "from=2026-09-15&to=2026-09-30&visitor_type=returning", "from=2026-09-15&to=2026-09-30&visitor_type=new"]) {
  const sql = await call(analytics, qs, { installed: true });
  const old = await call(analytics, qs, { installed: false });
  check(`[${qs}] both paths answer 200`, sql.status === 200 && old.status === 200, `${sql.status}/${old.status}`);
  let same = true;
  try { assert.deepEqual(sql.body, old.body); } catch (e) { same = false; }
  check(`[${qs}] SQL-path response is identical to the fallback's`, same);
  check(`[${qs}] SQL path uses the 2 RPCs and no paged table reads`, sql.counters.rpcNames.join() === "admin_analytics_event_groups,admin_analytics_ad_groups" && sql.counters.requests === 0, JSON.stringify(sql.counters));
  check(`[${qs}] fallback pages through PostgREST within its 1000-row cap`, old.counters.maxReturned <= 1000 && old.counters.requests >= 2, JSON.stringify(old.counters));
}
{
  const full = await call(analytics, "from=2026-09-01&to=2026-09-30", { installed: false });
  const total = full.body.overview.page_views + 0;
  const truth = events.filter((e) => e.event_name === "page_view").length;
  check("30-day fallback needs many sequential paged reads (what the SQL path removes)", full.counters.requests >= 5, String(full.counters.requests));
  check("fallback is complete (counts every page view despite the 1000-row cap)", total === truth && full.body.geo_coverage.events === events.length, `${total}/${truth}`);
}
check("mode=role returns the role without touching analytics", (await call(analytics, "mode=role", { installed: true })).body.role === "admin" && (await call(analytics, "mode=role", { installed: true })).counters.rpc === 0);

// --- authorization / validation ----------------------------------------------------------------------------------
for (const [name, handler] of [["admin-analytics", analytics], ["admin-analytics-export", exporter]]) {
  const qs = "from=2026-09-01&to=2026-09-30&report_type=full&dataset=events";
  check(`${name}: no user -> 401`, (await call(handler, qs, { installed: true, userId: null })).status === 401);
  check(`${name}: inactive admin -> 403`, (await call(handler, qs, { installed: true, active: false })).status === 403);
  check(`${name}: start > end -> 400`, (await call(handler, "from=2026-09-30&to=2026-09-01&report_type=full&dataset=events", { installed: true })).status === 400);
  check(`${name}: cleared date -> 400`, (await call(handler, "from=&to=2026-09-01&report_type=full&dataset=events", { installed: true })).status === 400);
  check(`${name}: POST rejected`, (await call(handler, qs, { installed: true, method: "POST" })).status === 405);
}
check("export: analyst (read-only role) -> 403", (await call(exporter, "from=2026-09-01&to=2026-09-30&report_type=full&dataset=events", { installed: true, role: "analyst" })).status === 403);

// --- export paging: SQL path vs fallback vs old route protocol ----------------------------------------------------
async function walk(qsBase, { installed, large }) {
  const ids = [];
  let after = 0, pages = 0, profiles = 0, maxPage = 0;
  for (;;) {
    const r = await call(exporter, `${qsBase}&dataset=events&after=${after}&limit=1000${large ? "&page=large" : ""}`, { installed });
    assert.equal(r.status, 200);
    pages++;
    if (r.body.profile) profiles++;
    maxPage = Math.max(maxPage, r.body.rows.length);
    for (const row of r.body.rows) ids.push(row.record_id);
    if (r.body.next_after === null) break;
    after = r.body.next_after;
  }
  return { ids, pages, profiles, maxPage };
}
const month = "from=2026-09-01&to=2026-09-30&report_type=full";
const expectedIds = events.map((e) => e.id);
const a = await walk(month, { installed: true, large: true });
const b = await walk(month, { installed: false, large: true });
const c = await walk(month, { installed: true, large: false });
const d = await walk(month, { installed: false, large: false });
for (const [label, r] of [["SQL + large pages", a], ["fallback + large request", b], ["SQL + old-style 1000 pages", c], ["fallback + old-style 1000 pages", d]]) {
  check(`export ${label}: every row exactly once, in order`, JSON.stringify(r.ids) === JSON.stringify(expectedIds), `${r.ids.length}/${expectedIds.length}`);
}
check("large pages: far fewer calls than 1000-row pages", a.pages < c.pages && a.pages === Math.ceil(events.length / 5000), `${a.pages} vs ${c.pages}`);
check("fallback never claims a page larger than PostgREST's 1000-row cap", b.maxPage <= 1000 && d.maxPage <= 1000);
check("later large pages skip the profile lookup", a.profiles === 1 || a.pages === 1, String(a.profiles));
check("old-style callers still get the profile on every page", c.profiles === c.pages);
const f1 = await call(exporter, "from=2026-09-01&to=2026-09-30&report_type=full&dataset=events&country=NG&state_province=LA&after=0&limit=1000&page=large", { installed: true });
const f2 = await call(exporter, "from=2026-09-01&to=2026-09-30&report_type=full&dataset=events&country=NG&state_province=LA&after=0&limit=1000&page=large", { installed: false });
const want = events.filter((e) => e.country_code === "NG" && e.region === "LA").length;
check("export filters respected on both paths", f1.body.rows.length === want && f2.body.rows.length === Math.min(want, 1000) && f1.body.rows.every((r) => r.country_code === "NG" && r.state_province === "LA"), `${f1.body.rows.length}/${f2.body.rows.length}/${want}`);
const oneDay = await call(exporter, "from=2026-09-10&to=2026-09-10&report_type=full&dataset=events&after=0&limit=1000&page=large", { installed: true });
check("one-day export contains only that UTC day", oneDay.body.rows.length === events.filter((e) => e.created_at.startsWith("2026-09-10")).length && oneDay.body.rows.every((r) => r.occurred_at.startsWith("2026-09-10")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
