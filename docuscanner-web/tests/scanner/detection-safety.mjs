// How safe is automatic cropping? Runs the app's real boundary detector (utils/scanner/detection.ts) and crop-safety
// check on synthetic camera frames with known page outlines, and reports for each: what was detected, how much of the
// true page the crop keeps, whether the corner markers survive, and what each policy would do:
//   old policy: apply the crop when confidence >= 0.55;  new policy: also require the safety check to pass.
// SIMULATED frames (drawn pictures), not photographs.
//   node --no-warnings --import ./tests/scanner/register.mjs tests/scanner/detection-safety.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { fixtures, judge, randomFixture } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas");
globalThis.document = { createElement: () => createCanvas(1, 1) };
const { detectDocumentQuad } = await import("../../utils/scanner/detection.ts");

const THRESHOLD = 0.55;
const here = path.dirname(fileURLToPath(import.meta.url));
const rows = [];
for (const f of fixtures()) {
  const r = detectDocumentQuad(f.canvas);
  const j = judge(f, r?.quad);
  const oldApplies = !!r && r.confidence >= THRESHOLD;
  const newApplies = oldApplies && r.safe;
  const damaging = (applies) => applies && (j.coverage < 0.97 || j.markersKept < j.markersTotal);
  rows.push({
    name: f.name,
    note: f.note,
    detected: !!r,
    confidence: r ? +r.confidence.toFixed(2) : 0,
    safe: r?.safe ?? false,
    reason: r?.safetyReason ?? "not detected",
    coverage: +(j.coverage * 100).toFixed(1),
    markers: `${j.markersKept}/${j.markersTotal}`,
    oldApplies,
    newApplies,
    oldDamages: damaging(oldApplies),
    newDamages: damaging(newApplies),
  });
}
console.log("fixture".padEnd(26), "conf", "safe ", "cover%", "marks", "old  ", "new  ", "old damages", "new damages", " why");
for (const r of rows) console.log(r.name.padEnd(26), String(r.confidence).padEnd(4), String(r.safe).padEnd(5), String(r.coverage).padEnd(6), r.markers.padEnd(5), (r.oldApplies ? "crop" : "keep").padEnd(5), (r.newApplies ? "crop" : "keep").padEnd(5), String(r.oldDamages).padEnd(11), String(r.newDamages).padEnd(11), r.reason);
const oldBad = rows.filter((r) => r.oldDamages).length, newBad = rows.filter((r) => r.newDamages).length;
const cropped = rows.filter((r) => r.newApplies).length;
console.log(`\nfixtures ${rows.length}; old policy applies a damaging crop on ${oldBad}; new policy on ${newBad}; new policy still auto-crops ${cropped}`);
fs.writeFileSync(path.join(here, "detection-safety-results.json"), JSON.stringify(rows, null, 2));
// Beyond the hand-made cases: 80 random desk scenes (page size, turn, desk and paper brightness, shadows, lighting).
const stress = [];
for (let i = 0; i < 80; i++) {
  const f = randomFixture(i);
  const r = detectDocumentQuad(f.canvas);
  const j = judge(f, r?.quad);
  const old = !!r && r.confidence >= THRESHOLD;
  const now = old && r.safe;
  const dmg = (a) => a && (j.coverage < 0.97 || j.markersKept < j.markersTotal);
  stress.push({ i, old, now, oldDamages: dmg(old), newDamages: dmg(now), conf: r?.confidence ?? 0, coverage: j.coverage, markers: `${j.markersKept}/${j.markersTotal}` });
}
const sum = (k) => stress.filter((s) => s[k]).length;
console.log(`
random desk scenes: ${stress.length}; old policy crops ${sum("old")} (damaging ${sum("oldDamages")}); new policy crops ${sum("now")} (damaging ${sum("newDamages")}); left for the person to decide ${stress.length - sum("now")}`);
for (const s of stress.filter((x) => x.oldDamages || x.newDamages)) console.log("   damaging:", JSON.stringify(s));
fs.writeFileSync(path.join(here, "detection-safety-stress.json"), JSON.stringify(stress, null, 2));
// The audit's own pictures (real files in tests/audit/corpus). The earlier audit found the suggested crop cutting text off the
// right edge of scan.jpg; "ink lost" is the share of dark (text) pixels that fall outside the detected crop.
const { loadImage } = require("@napi-rs/canvas");
const corpus = [];
for (const file of ["scan.jpg", "photo-std.jpg", "photo-landscape.jpg", "portrait-photo.jpg", "photo-hi.jpg"]) {
  const img = await loadImage(path.join(here, "..", "audit", "corpus", file));
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  const r = detectDocumentQuad(c);
  const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const inside = (q, x, y) => { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x); if (cr !== 0) { if (s === 0) s = Math.sign(cr); else if (Math.sign(cr) !== s) return false; } } return true; };
  let dark = 0, lost = 0;
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
    const i = (y * c.width + x) * 4;
    if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 90) { dark++; if (r && !inside(r.quad, x, y)) lost++; }
  }
  const row = { file, size: `${img.width}x${img.height}`, detected: !!r, confidence: r ? +r.confidence.toFixed(2) : 0, safe: r?.safe ?? false, why: r?.safetyReason ?? "not detected", inkLostIfApplied: dark ? +((lost / dark) * 100).toFixed(2) : 0, oldApplies: !!r && r.confidence >= THRESHOLD, newApplies: !!r && r.confidence >= THRESHOLD && r.safe };
  corpus.push(row);
  console.log(row.file.padEnd(20), row.size.padEnd(10), "conf", String(row.confidence).padEnd(4), "safe", String(row.safe).padEnd(5), "ink lost if cropped", (row.inkLostIfApplied + "%").padEnd(8), "old", row.oldApplies ? "crop" : "keep", "new", row.newApplies ? "crop" : "keep", "-", row.why);
}
fs.writeFileSync(path.join(here, "detection-safety-corpus.json"), JSON.stringify(corpus, null, 2));
const strict = process.argv.includes("--strict");
if (strict) {
  assert.equal(newBad, 0, "no damaging crop may be applied automatically");
  assert.equal(sum("newDamages"), 0, "no damaging crop in the random scenes");
  for (const n of ["desk-a4-rotated-5", "desk-a4-portrait-frame", "desk-landscape-page"]) assert.ok(rows.find((r) => r.name === n).newApplies, `${n} should still be cropped automatically`);
  for (const c of corpus) assert.ok(!c.newApplies || c.inkLostIfApplied < 0.5, `${c.file}: an automatic crop would lose ${c.inkLostIfApplied}% of the ink`);
  console.log("detection safety checks passed");
}
