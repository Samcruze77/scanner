// Real-browser check (production build, Playwright + installed Chrome/Edge) that a verified
// administrator is neither recorded by first-party analytics nor by Microsoft Clarity, on PUBLIC
// pages, while guests and signed-in customers still are.
//
// What is real here: the app's own code (AuthProvider, AudienceProvider, AnalyticsListener,
// PresenceHeartbeat, MicrosoftClarity), consent, and the browser's cookies/storage/network.
// What is simulated: the Supabase session (a signed-looking cookie; the app's browser client does not
// verify signatures), the server's answer to /api/analytics/audience (this test is about how the page
// reacts to it; the server's own decision is covered by tests/analytics/admin-exclusion.mjs), the
// analytics endpoints, and Clarity itself (a stub: nothing is sent to Microsoft).
//
// Start the build first:
//   NEXT_PUBLIC_CLARITY_PROJECT_ID=zzTESTzz1 npm run build && npx next start -p 3117
// Run:  BASE_URL=http://localhost:3117 node tests/analytics/admin-browser.mjs

import fs from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found. Set CHROME to a browser executable.");
const BASE = process.env.BASE_URL ?? "http://localhost:3117";
const PROJECT_REF = "zdegimgixjpirtivrrgc"; // the app's NEXT_PUBLIC_SUPABASE_URL ref (cookie name sb-<ref>-auth-token)

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log("PASS", name);
  else {
    failed++;
    console.log("FAIL", name, detail ? `\n   ${detail}` : "");
  }
};

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sessionCookie(userId) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: userId, aud: "authenticated", role: "authenticated", exp: now + 3600 })}.sig`;
  const session = {
    access_token: jwt,
    refresh_token: "r",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: userId, aud: "authenticated", role: "authenticated", email: "someone@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
  return { name: `sb-${PROJECT_REF}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: BASE };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// who: "guest" | "customer" | "admin" | "unverified" (signed in, the role check fails)
async function visit(who, { audienceDelayMs = 0, pages = ["/", "/scan"] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("ds_consent", JSON.stringify({ version: 1, decided_at: "2026-10-28T00:00:00Z", analytics: true, advertising: true, recordings: true }));
    } catch {}
  });
  if (who !== "guest") await context.addCookies([sessionCookie("33333333-3333-4333-8333-333333333333")]);
  const seen = { track: [], heartbeat: [], adEvent: [], audience: [], clarity: [] };
  const t0 = Date.now();
  await context.route("**/api/analytics/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/audience")) {
      seen.audience.push(Date.now() - t0);
      if (audienceDelayMs) await new Promise((r) => setTimeout(r, audienceDelayMs));
      if (who === "unverified") return route.fulfill({ status: 503, json: { error: "unavailable" } });
      return route.fulfill({ status: 200, json: { excluded: who === "admin" } });
    }
    const key = p.endsWith("/track") ? "track" : p.endsWith("/heartbeat") ? "heartbeat" : "adEvent";
    seen[key].push(Date.now() - t0);
    return route.fulfill({ status: 202, json: { ok: true } });
  });
  await context.route("**/www.clarity.ms/**", (route) => {
    seen.clarity.push(Date.now() - t0);
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* stub */" });
  });
  await context.route(/(bing|microsoft)\.com/, (route) => route.abort());
  await context.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, json: {} }));
  const page = await context.newPage();
  const early = {};
  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    if (audienceDelayMs && !early.at) {
      await page.waitForTimeout(Math.min(audienceDelayMs - 300, 900));
      early.at = true;
      early.track = seen.track.length;
      early.heartbeat = seen.heartbeat.length;
      early.clarity = seen.clarity.length;
    }
    await page.waitForTimeout(3500 + audienceDelayMs);
  }
  await context.close();
  return { seen, early };
}

console.log("Guest (not signed in)");
{
  const { seen } = await visit("guest");
  check("guest page views are tracked", seen.track.length >= 2, JSON.stringify(seen.track));
  check("guest presence heartbeats are sent", seen.heartbeat.length >= 1);
  check("Clarity loads for a guest who opted in", seen.clarity.length >= 1);
  check("no administrator check is made for a guest", seen.audience.length === 0);
}
console.log("Signed-in customer (server says: not an administrator)");
{
  const { seen } = await visit("customer");
  check("the administrator check is made", seen.audience.length >= 1);
  check("customer page views are tracked", seen.track.length >= 2, JSON.stringify(seen.track));
  check("customer presence is sent", seen.heartbeat.length >= 1);
  check("Clarity loads for a customer", seen.clarity.length >= 1);
}
console.log("Administrator on PUBLIC pages (/, /scan) -- not /admin");
{
  const { seen } = await visit("admin");
  check("the administrator check is made", seen.audience.length >= 1);
  check("NO page view / app_open is sent", seen.track.length === 0, JSON.stringify(seen.track));
  check("NO presence heartbeat is sent", seen.heartbeat.length === 0, JSON.stringify(seen.heartbeat));
  check("Clarity is NEVER requested", seen.clarity.length === 0, JSON.stringify(seen.clarity));
}
console.log("Administrator while the role check is still pending (answer delayed 2 s)");
{
  const { seen, early } = await visit("admin", { audienceDelayMs: 2000, pages: ["/"] });
  check("nothing was sent and Clarity was not requested BEFORE the check finished", early.track === 0 && early.heartbeat === 0 && early.clarity === 0, JSON.stringify(early));
  check("nothing is sent after it finishes either", seen.track.length === 0 && seen.heartbeat.length === 0 && seen.clarity.length === 0, JSON.stringify(seen));
}
console.log("Customer while the check is pending: tracking waits, then starts");
{
  const { seen, early } = await visit("customer", { audienceDelayMs: 2000, pages: ["/"] });
  check("nothing was sent before the check finished", early.track === 0 && early.heartbeat === 0 && early.clarity === 0, JSON.stringify(early));
  check("tracking and Clarity start once it says 'not an administrator'", seen.track.length >= 1 && seen.clarity.length >= 1, JSON.stringify(seen));
}
console.log("Signed in but the role check fails (503)");
{
  const { seen } = await visit("unverified");
  check("first-party events still go to the server (which excludes administrators itself)", seen.track.length >= 1, JSON.stringify(seen.track));
  check("Clarity is NOT loaded when the browser cannot be sure", seen.clarity.length === 0, JSON.stringify(seen.clarity));
}

await browser.close();
process.exit(failed ? 1 : 0);
