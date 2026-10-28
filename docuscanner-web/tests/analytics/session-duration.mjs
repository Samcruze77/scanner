// Session duration and session-idle semantics.
//   * sessionDurationSeconds / formatDuration: ordinary sessions, sessions crossing midnight,
//     missing/invalid timestamps, small clock skew, and genuine sessions longer than 72 hours (no cap).
//   * the real identity module over fake browser storage: a background heartbeat must NOT extend a
//     session or revive an expired one; real user activity does; a new session starts after 30 idle
//     minutes (so unrelated sessions of the same visitor are not merged).
//   * the shipped files use these (heartbeat reads with peekSessionId, Live shows the validated duration).
//
// Run: node --no-warnings --import ./tests/scanner/register.mjs tests/analytics/session-duration.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import { CLOCK_SKEW_MS, formatDuration, sessionDurationSeconds } from "../../utils/analytics/sessionDuration.ts";

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log("PASS", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, "\n  ", e.message);
  }
};

check("ordinary session", () => {
  assert.equal(sessionDurationSeconds("2026-10-20T10:00:00Z", "2026-10-20T10:12:30Z"), 750);
  assert.equal(formatDuration(750), "12m 30s");
  assert.equal(formatDuration(45), "45s");
});
check("session crossing midnight (and UTC offsets) is wall-clock elapsed time", () => {
  assert.equal(sessionDurationSeconds("2026-10-20T23:50:00Z", "2026-10-21T00:20:00Z"), 1800);
  assert.equal(sessionDurationSeconds("2026-10-20T23:50:00+00:00", "2026-10-21T01:20:00+01:00"), 1800);
});
check("missing, empty or unparseable timestamps give 'Unknown', never 0", () => {
  for (const [a, b] of [[null, "2026-10-20T10:00:00Z"], ["2026-10-20T10:00:00Z", undefined], ["", ""], ["not a date", "2026-10-20T10:00:00Z"], [{}, []]]) {
    assert.equal(sessionDurationSeconds(a, b), null);
  }
  assert.equal(formatDuration(null), "Unknown");
  assert.equal(formatDuration(Number.NaN), "Unknown");
  assert.equal(formatDuration(-5), "Unknown");
});
check("last_seen slightly before started_at (clock skew) is 0; further back is invalid", () => {
  assert.equal(sessionDurationSeconds("2026-10-20T10:00:05.879Z", "2026-10-20T10:00:00Z"), 0);
  assert.equal(sessionDurationSeconds("2026-10-20T10:00:00Z", new Date(Date.parse("2026-10-20T10:00:00Z") - CLOCK_SKEW_MS - 1).toISOString()), null);
});
check("a genuine session longer than 72 hours is reported as it is (no arbitrary cap)", () => {
  const secs = sessionDurationSeconds("2026-10-01T00:00:00Z", "2026-10-05T06:30:00Z"); // 4 d 6 h 30 m
  assert.equal(secs, (4 * 24 + 6) * 3600 + 30 * 60);
  assert.equal(formatDuration(secs), "4d 6h 30m");
  assert.equal(formatDuration(72 * 3600), "3d 0h 0m");
  assert.equal(formatDuration(72 * 3600 + 1), "3d 0h 0m");
});
check("separate sessions of one user are separate durations (never summed or merged)", () => {
  const sessions = [
    { session_id: "a", user_id: "u", started_at: "2026-10-20T08:00:00Z", last_seen: "2026-10-20T08:10:00Z" },
    { session_id: "b", user_id: "u", started_at: "2026-10-20T20:00:00Z", last_seen: "2026-10-20T20:05:00Z" },
  ];
  assert.deepEqual(sessions.map((s) => sessionDurationSeconds(s.started_at, s.last_seen)), [600, 300]);
});

// ---- real identity module over fake browser storage ----------------------------------------------------------------
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
globalThis.window = { localStorage: fakeStorage(), sessionStorage: fakeStorage() };
const { CONSENT_KEY, CONSENT_VERSION } = await import("../../utils/consent/consent.ts");
window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION, decided_at: "x", analytics: true, advertising: false, recordings: false }));
const identity = await import("../../utils/analytics/identity.ts");
const { SESSION_IDLE_MS, getSessionId, peekSessionId, markActivity, resetActivityThrottleForTests } = identity;
const realNow = Date.now;
let clock = Date.parse("2026-10-20T09:00:00Z");
Date.now = () => clock;
const advance = (ms) => { clock += ms; };

check("a heartbeat (peek) never extends a session: an idle visible tab's session ends after 30 minutes", () => {
  const first = getSessionId(); // page load / user event
  assert.ok(first);
  for (let i = 0; i < 100; i++) { advance(30_000); assert.ok(i < 59 ? peekSessionId() === first : true); }
  // ~50 minutes of 30-second heartbeats, no user activity: the session has expired and is not revived.
  assert.equal(peekSessionId(), null, "heartbeats alone must not keep the session alive");
});
check("user activity keeps a session alive; after 30 idle minutes the next activity starts a NEW session", () => {
  resetActivityThrottleForTests();
  const a = getSessionId();
  advance(20 * 60_000); markActivity(); assert.equal(peekSessionId(), a);
  resetActivityThrottleForTests();
  advance(20 * 60_000); markActivity(); assert.equal(peekSessionId(), a, "activity within 30 minutes extends it");
  advance(SESSION_IDLE_MS + 60_000);
  assert.equal(peekSessionId(), null);
  resetActivityThrottleForTests();
  markActivity();
  const b = peekSessionId();
  assert.ok(b && b !== a, "a visit after a long gap is a separate session");
});
check("without analytics consent nothing is read or created", () => {
  window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION, decided_at: "x", analytics: false, advertising: false, recordings: false }));
  assert.equal(peekSessionId(), null);
  assert.equal(getSessionId(), null);
});
Date.now = realNow;

// ---- shipped wiring ------------------------------------------------------------------------------------------------
check("the heartbeat only pulses (peek) except on page load / becoming visible, and listens for real activity", () => {
  const src = fs.readFileSync("components/presence/PresenceHeartbeat.tsx", "utf8");
  assert.ok(src.includes("activity ? getSessionId() : peekSessionId()"));
  assert.ok(src.includes('sendHeartbeat(pathname || "/", true)'));
  assert.ok(src.includes("markActivity"));
});
check("Live shows the validated session length; no 72-hour constant or cap exists in app code", () => {
  assert.ok(fs.readFileSync("app/admin/live/LiveClient.tsx", "utf8").includes("sessionDurationSeconds(s.started_at, s.last_seen)"));
  for (const f of ["utils/analytics/sessionDuration.ts", "utils/analytics/identity.ts", "components/presence/PresenceHeartbeat.tsx"]) {
    assert.ok(!/72\s*\*|72h|259200|\b72_/.test(fs.readFileSync(f, "utf8")), `${f} must not contain a 72-hour cap`);
  }
});

process.exit(failed ? 1 : 0);
