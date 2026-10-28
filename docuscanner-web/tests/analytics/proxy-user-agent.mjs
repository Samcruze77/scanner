// The analytics proxies must hand the VISITOR's user agent to the Edge Functions;
// otherwise every event is classified from the proxy's own fetch client (device
// "desktop", browser/OS "other"), hiding mobile and tablet traffic from the admin.
// Run: node --no-warnings --import ./tests/scanner/register.mjs tests/analytics/proxy-user-agent.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { deviceFromUserAgent, browserFromUserAgent, osFromUserAgent } from "../../supabase/functions/_shared/geo.ts";

// A real local server, so the check covers what actually goes on the wire (Node's fetch
// is allowed to override User-Agent; a stubbed fetch cannot prove that).
let received;
const server = http.createServer((req, res) => { received = req.headers; res.end("{}"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SECRET_KEY = "test-secret";
const { callEdgeFunction, visitorUserAgent } = await import("../../utils/analytics/edgeCall.ts");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n  ", e.message); } };

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const realFetch = globalThis.fetch;
await check("a real HTTP request carries the visitor User-Agent, not the proxy client's", async () => {
  const r = await callEdgeFunction("track-analytics", { a: 1 }, IPHONE);
  assert.equal(r.ok, true);
  assert.equal(received["user-agent"], IPHONE);
  assert.equal(received.apikey, "test-secret");
});

let seen;
globalThis.fetch = async (url, init) => { seen = { url, headers: init.headers }; return new Response("{}", { status: 200 }); };

await check("visitor UA is forwarded to the Edge Function", async () => {
  await callEdgeFunction("track-analytics", { a: 1 }, IPHONE);
  assert.equal(seen.headers["User-Agent"], IPHONE);
  assert.equal(seen.headers.apikey, "test-secret");
});
await check("no UA means no override header (never an empty header)", async () => {
  await callEdgeFunction("track-analytics", { a: 1 }, null);
  assert.ok(!("User-Agent" in seen.headers));
});
await check("visitorUserAgent reads, trims and caps the header", () => {
  assert.equal(visitorUserAgent(new Request("https://x", { headers: { "user-agent": `  ${IPAD} ` } })), IPAD);
  assert.equal(visitorUserAgent(new Request("https://x")), null);
  assert.equal(visitorUserAgent(new Request("https://x", { headers: { "user-agent": "a".repeat(2000) } })).length, 512);
});
await check("forwarded UAs classify as mobile / tablet, not the proxy's own client", () => {
  assert.equal(deviceFromUserAgent(IPHONE), "mobile");
  assert.equal(deviceFromUserAgent(IPAD), "tablet");
  assert.equal(deviceFromUserAgent("node"), "desktop");
  assert.equal(osFromUserAgent(IPHONE), "ios");
  assert.equal(browserFromUserAgent(IPHONE), "safari");
});
for (const slug of ["track", "heartbeat", "ad-event"]) {
  await check(`/api/analytics/${slug} forwards the visitor UA`, () => {
    const src = readFileSync(`app/api/analytics/${slug}/route.ts`, "utf8");
    assert.ok(src.includes("visitorUserAgent(request)"));
  });
}
server.close();
process.exit(failed ? 1 : 0);
