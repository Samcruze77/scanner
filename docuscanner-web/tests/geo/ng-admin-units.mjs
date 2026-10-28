// Validates the Nigerian administrative dataset by names and parents, not just totals.
// Expected per-state LGA counts are the published constitutional figures (768 + 6 FCT
// Area Councils = 774), typed here independently of the source workbook.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("data/geo/ng-admin-units.json", "utf8"));
const seed = readFileSync("supabase/seed/ng_admin_units.sql", "utf8");

const EXPECTED = {
  Abia: 17, Adamawa: 21, "Akwa Ibom": 31, Anambra: 21, Bauchi: 20, Bayelsa: 8, Benue: 23, Borno: 27,
  "Cross River": 18, Delta: 25, Ebonyi: 13, Edo: 18, Ekiti: 16, Enugu: 17, Gombe: 11, Imo: 27,
  Jigawa: 27, Kaduna: 23, Kano: 44, Katsina: 34, Kebbi: 21, Kogi: 21, Kwara: 16, Lagos: 20,
  Nasarawa: 13, Niger: 25, Ogun: 20, Ondo: 18, Osun: 30, Oyo: 33, Plateau: 17, Rivers: 23,
  Sokoto: 23, Taraba: 16, Yobe: 17, Zamfara: 14,
};
const FCT_COUNCILS = ["Abaji", "Abuja Municipal", "Bwari", "Gwagwalada", "Kuje", "Kwali"];
const SPOT = { Lagos: ["Ikeja", "Eti-Osa", "Alimosho", "Badagry"], Kano: ["Nasarawa", "Gwale", "Tarauni"], Rivers: ["Port-Harcourt", "Obia/Akpor"] };

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
let failed = 0;
function check(name, fn) {
  try { fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n  ", e.message); }
}

const byCode = new Map(data.states.map((s) => [s.code, s]));
const stateByName = new Map(data.states.map((s) => [norm(s.name), s]));
const lgasOf = (s) => data.lgas.filter((l) => l.stateCode === s.code);

check("36 states + FCT", () => {
  assert.equal(data.states.length, 37);
  assert.equal(data.states.filter((s) => s.type === "state").length, 36);
  assert.equal(data.states.filter((s) => s.type === "federal_capital_territory").length, 1);
  for (const name of Object.keys(EXPECTED)) assert.ok(stateByName.has(norm(name)), `missing state ${name}`);
  assert.equal(new Set(data.states.map((s) => s.isoCode)).size, 37, "ISO codes not unique");
});
check("774 local-level units: 768 LGAs + 6 area councils", () => {
  assert.equal(data.lgas.length, 774);
  assert.equal(data.lgas.filter((l) => l.type === "lga").length, 768);
  assert.equal(data.lgas.filter((l) => l.type === "area_council").length, 6);
});
check("per-state LGA counts match published figures", () => {
  for (const [name, n] of Object.entries(EXPECTED)) assert.equal(lgasOf(stateByName.get(norm(name))).length, n, name);
  assert.equal(Object.values(EXPECTED).reduce((a, b) => a + b, 0), 768);
});
check("FCT has exactly the six Area Councils", () => {
  const fct = data.states.find((s) => s.type === "federal_capital_territory");
  assert.deepEqual(lgasOf(fct).map((l) => l.name).sort(), [...FCT_COUNCILS].sort());
  assert.ok(lgasOf(fct).every((l) => l.type === "area_council"));
});
check("every unit has a valid parent and code prefix", () => {
  for (const l of data.lgas) {
    assert.ok(byCode.has(l.stateCode), `${l.code} orphan`);
    assert.ok(l.code.startsWith(l.stateCode), `${l.code} not under ${l.stateCode}`);
  }
});
check("no duplicates (codes, or names within a state)", () => {
  assert.equal(new Set(data.lgas.map((l) => l.code)).size, data.lgas.length);
  for (const s of data.states) {
    const names = lgasOf(s).map((l) => l.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, `duplicate name in ${s.name}`);
  }
});
check("spot-check known units under their states", () => {
  for (const [st, names] of Object.entries(SPOT)) {
    const have = lgasOf(stateByName.get(norm(st))).map((l) => l.name);
    for (const n of names) assert.ok(have.includes(n), `${n} not under ${st}`);
  }
});
check("no blank or padded names", () => {
  for (const u of [...data.states, ...data.lgas]) assert.ok(u.name && u.name === u.name.trim(), u.code);
});
check("seed SQL carries every unit once and is an idempotent upsert", () => {
  const rows = seed.match(/^  \('NG', /gm) ?? [];
  assert.equal(rows.length, 811);
  assert.match(seed, /on conflict \(country_code, code\) do update/);
  assert.ok(!/\bdelete\b|\btruncate\b/i.test(seed.replace(/--.*$/gm, "")));
  for (const u of [...data.states, ...data.lgas]) assert.ok(seed.includes(`'${u.code}', '${u.name.replace(/'/g, "''")}'`), u.code);
});

// MD5 of "code|name|type|parent" rows ordered by code, as computed inside the production
// geo_admin_units table on 2026-10-28 (project zdegimgixjpirtivrrgc). If the JSON changes,
// the table must be re-seeded and this value updated together.
const PRODUCTION_CHECKSUM = "1ede397725446b59a0f8e9ea63f90898";
check("bundled JSON is identical to what is loaded in production", () => {
  const rows = [...data.states.map((s) => [s.code, s.name, s.type, ""]), ...data.lgas.map((l) => [l.code, l.name, l.type, l.stateCode])]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  assert.equal(createHash("md5").update(rows.map((r) => r.join("|")).join("~")).digest("hex"), PRODUCTION_CHECKSUM);
});

process.exit(failed ? 1 : 0);
