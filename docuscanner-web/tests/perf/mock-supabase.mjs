// Stand-in Supabase for profiling ONLY (127.0.0.1:54321). Simulates latency; counts calls.
//   MOCK_ANALYTICS_MS=1500 MOCK_AUTH_MS=150 node tests/perf/mock-supabase.mjs
import http from "node:http";
import { eventToRecord } from "../../supabase/functions/_shared/exportRows.ts";
import { buildAdminProfile } from "../../supabase/functions/_shared/adminProfile.ts";
import { resolveRange } from "../../supabase/functions/_shared/analyticsFilters.ts";

// Deterministic export dataset: 12,000 events, 400/day across Sep 1-30 2026 (UTC), alternating cities/devices.
const EVENTS = Array.from({ length: 12000 }, (_, i) => ({
  id: i + 1, event_name: "page_view", visitor_id: `v${i % 900}`, session_id: `s${i % 1500}`, user_id: null, path: "/scan", referrer: null,
  country_code: i % 2 ? "NG" : "US", region: i % 2 ? "LA" : "CA", city: i % 2 ? "Lagos" : "San Jose", county_district_lga: null, neighborhood_suburb: null,
  postal_code: null, location_source: "vercel", device_type: i % 3 ? "mobile" : "desktop", browser: "chrome", operating_system: "linux", properties: {},
  created_at: new Date(Date.parse("2026-09-01T00:00:00Z") + Math.floor(i / 400) * 86_400_000 + (i % 400) * 200_000).toISOString(),
}));
const PROFILE = buildAdminProfile({ adminRow: { user_id: "u1", role: "admin", display_name: null, is_active: true, created_at: "2026-09-22T00:00:00Z", updated_at: "2026-09-22T00:00:00Z" }, userProfileRow: null, authUser: { id: "u1", email: "admin@example.test", phone: "", last_sign_in_at: null, created_at: "2026-09-22T00:00:00Z", updated_at: "2026-09-22T00:00:00Z", user_metadata: {} } });
const exportPages = [];
const A = Number(process.env.MOCK_ANALYTICS_MS ?? 1500), U = Number(process.env.MOCK_AUTH_MS ?? 150);
const calls = {};
const geo = (over = {}) => ({ role: "admin", range: {}, filters: {}, overview: {}, breakdowns: {}, geo: { countries: [], levels: {}, regions_by_country: {}, cities_by_country: {} }, locations: [], daily: [], ...over });
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const key = u.pathname + (u.searchParams.get("mode") ? `?mode=${u.searchParams.get("mode")}` : "");
  calls[key] = (calls[key] ?? 0) + 1;
  const send = (body, ms = 0, status = 200) => setTimeout(() => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); }, ms);
  if (u.pathname === "/__calls") return send(calls);
  if (u.pathname === "/__reset") { for (const k in calls) delete calls[k]; return send({}); }
  if (u.pathname === "/auth/v1/user") return send({ id: "u1", aud: "authenticated", role: "authenticated", email: "a@b.c" }, U);
  if (u.pathname.startsWith("/functions/v1/admin-analytics-export")) {
    if (u.searchParams.get("mode") === "options") return send({ campaigns: [], creatives: [], slots: [] });
    (globalThis.exportQueries ??= []).push(u.search);
    const dataset = u.searchParams.get("dataset");
    const after = Number(u.searchParams.get("after") ?? 0);
    const large = u.searchParams.get("page") === "large";
    const size = large ? 5000 : Math.min(Number(u.searchParams.get("limit") ?? 1000), 1000);
    const range = resolveRange(u.searchParams);
    if (dataset !== "events" || !range.ok) return send({ profile: PROFILE, dataset, rows: [], next_after: null, scanned: 0 });
    const country = u.searchParams.get("country");
    const scanned = EVENTS.filter((e) => e.id > after && e.created_at >= range.from.toISOString() && e.created_at < range.toExclusive.toISOString() && (!country || e.country_code === country)).slice(0, size);
    exportPages.push({ after, size, rows: scanned.length });
    return send({ profile: large && after > 0 ? null : PROFILE, dataset, rows: scanned.map((e) => eventToRecord(e, "new")), next_after: scanned.length === size ? scanned[scanned.length - 1].id : null, scanned: scanned.length }, 120);
  }
  if (u.pathname === "/__export_pages") return send(exportPages);
  if (u.pathname === "/__export_queries") return send(globalThis.exportQueries ?? []);
  if (u.pathname === "/functions/v1/admin-analytics") return send(u.searchParams.get("mode") === "role" ? { role: "admin" } : geo(), u.searchParams.get("mode") === "role" ? 30 : A);
  if (u.pathname.startsWith("/functions/v1/admin-live")) return send({ online_count: 0, sessions: [] }, 100);
  send({}, 20);
}).listen(54321, "127.0.0.1", () => console.log("mock up"));
