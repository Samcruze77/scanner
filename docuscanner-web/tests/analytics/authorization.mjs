// Live check against the deployed Supabase Edge Functions: confirms
// track-analytics/heartbeat/track-ad-event now reject any request that
// doesn't carry the project's secret key (auth: "secret"), since a browser
// used to be able to call them directly and forge its own country/region/
// city. This test NEVER reads or sends the real secret key -- it only
// exercises the negative case (missing/wrong key -> rejected) so nothing
// sensitive ever appears here or in its output.
//
// Needs network access to the real Supabase project. Run:
//   node tests/analytics/authorization.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

function readEnv() {
  const env = {};
  for (const file of [".env.local", ".env"]) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim();
    }
  }
  return env;
}

const ENV = readEnv();
const SUPABASE_URL = ENV.SUPABASE_URL ?? ENV.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) throw new Error("SUPABASE_URL not found in .env.local");

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

async function postWithoutAuth(slug, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function postWithWrongKey(slug, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: "sb_secret_definitely_not_the_real_key_000000" },
    body: JSON.stringify(body),
  });
  return res.status;
}

console.log("1. track-analytics rejects calls with no secret key");
{
  const status = await postWithoutAuth("track-analytics", {
    event_name: "page_view",
    visitor_id: "test",
    session_id: "test",
    geo: { country_code: "NG", region: "Lagos", city: "Lagos", source: "vercel" }, // even if a caller tries to forge geo directly
  });
  check("rejected (401/403)", status === 401 || status === 403, `got ${status}`);
}

console.log("2. heartbeat rejects calls with no secret key");
{
  const status = await postWithoutAuth("heartbeat", { session_id: "test", visitor_id: "test" });
  check("rejected (401/403)", status === 401 || status === 403, `got ${status}`);
}

console.log("3. track-ad-event rejects calls with no secret key");
{
  const status = await postWithoutAuth("track-ad-event", {
    campaign_id: "00000000-0000-0000-0000-000000000000",
    creative_id: "00000000-0000-0000-0000-000000000000",
    event_type: "impression",
  });
  check("rejected (401/403)", status === 401 || status === 403, `got ${status}`);
}

console.log("4. track-analytics rejects an invalid/forged secret key");
{
  const status = await postWithWrongKey("track-analytics", {
    event_name: "page_view",
    visitor_id: "test",
    session_id: "test",
  });
  check("rejected (401/403)", status === 401 || status === 403, `got ${status}`);
}

// NOTE: the gateway also answers 401 for a slug that is not deployed, so this
// check only proves anything once admin-analytics-export is deployed. The
// admin-role check itself lives in the function and is covered by
// tests/analytics/export.mjs (source assertions) and needs a real admin
// session to exercise end to end.
console.log("5. admin-analytics-export rejects unauthenticated and forged-token callers");
{
  const anon = await fetch(`${SUPABASE_URL}/functions/v1/admin-analytics-export?dataset=events&report_type=full`);
  if (anon.status === 404) {
    console.log("  SKIP admin-analytics-export is not deployed to this project yet");
  } else {
    check("no token rejected (401/403)", anon.status === 401 || anon.status === 403, `got ${anon.status}`);
    const forged = await fetch(`${SUPABASE_URL}/functions/v1/admin-analytics-export?dataset=events&report_type=full`, {
      headers: { Authorization: "Bearer not.a.real.jwt" },
    });
    check("forged token rejected (401/403)", forged.status === 401 || forged.status === 403, `got ${forged.status}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
