// Stand-in Supabase for profiling ONLY (127.0.0.1:54321). Simulates latency; counts calls.
//   MOCK_ANALYTICS_MS=1500 MOCK_AUTH_MS=150 node tests/perf/mock-supabase.mjs
import http from "node:http";
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
    return send({ profile: { admin_user_id: "u1", admin_role: "admin" }, dataset: u.searchParams.get("dataset"), rows: [], next_after: null, scanned: 0 });
  }
  if (u.pathname === "/__export_queries") return send(globalThis.exportQueries ?? []);
  if (u.pathname === "/functions/v1/admin-analytics") return send(u.searchParams.get("mode") === "role" ? { role: "admin" } : geo(), u.searchParams.get("mode") === "role" ? 30 : A);
  if (u.pathname.startsWith("/functions/v1/admin-live")) return send({ online_count: 0, sessions: [] }, 100);
  send({}, 20);
}).listen(54321, "127.0.0.1", () => console.log("mock up"));
