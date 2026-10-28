// Regression checks for the admin geography reference browser and the responsive
// admin shell. Run: node --no-warnings --import ./tests/scanner/register.mjs tests/geo/units-ui.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findUnits } from "../../utils/admin/adminUnits.ts";

const data = JSON.parse(readFileSync("data/geo/ng-admin-units.json", "utf8"));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n  ", e.message); } };
const code = (n) => data.states.find((s) => s.name === n).code;

check("no filter returns all 774", () => assert.equal(findUnits(data, "", "").length, 774));
check("state filter returns that state's units only", () => {
  const r = findUnits(data, code("Lagos"), "");
  assert.equal(r.length, 20);
  assert.ok(r.every((u) => u.stateName === "Lagos"));
});
check("FCT returns the six Area Councils", () => {
  const r = findUnits(data, code("Federal Capital Territory"), "");
  assert.equal(r.length, 6);
  assert.ok(r.every((u) => u.type === "area_council"));
});
check("search is case-insensitive, trimmed, and combines with the state", () => {
  assert.deepEqual(findUnits(data, code("Lagos"), "  IKEJA ").map((u) => u.name), ["Ikeja"]);
  assert.equal(findUnits(data, code("Kano"), "ikeja").length, 0);
  assert.equal(findUnits(data, "", "zzzz").length, 0);
});

const nav = readFileSync("app/admin/AdminNav.tsx", "utf8");
check("admin nav wraps instead of scrolling off-screen on small screens", () => {
  assert.ok(nav.includes("flex-wrap"));
  assert.ok(!nav.includes("overflow-x-auto"), "nav must not hide sections behind horizontal scroll");
  assert.ok(!/"mb-2 hidden/.test(nav), "role label must not be hidden on mobile");
});
const metric = readFileSync("components/admin/MetricCard.tsx", "utf8");
check("a missing metric is a dash, never a fabricated zero", () => assert.ok(metric.includes(': "—"}') && !metric.includes(": 0}")));

process.exit(failed ? 1 : 0);
