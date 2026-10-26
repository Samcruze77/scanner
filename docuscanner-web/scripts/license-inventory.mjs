// Writes a machine-readable inventory of every installed npm package (direct and transitive, production and development) with its
// version, the licence it declares, the licence files it ships and where it comes from, to docs/compliance/license-inventory.json.
// It reads package-lock.json and the installed packages only: nothing is uploaded and no dependency is needed.
//
//   node scripts/license-inventory.mjs                                 write the inventory of this project and print a summary
//   node scripts/license-inventory.mjs --check                         exit 1 when a production package has a licence that needs review (writes nothing)
//   node scripts/license-inventory.mjs --dir ../backend --label backend    the same for another project (read only), to ...-backend.json
//
// "dev" follows npm's own flag: a package that is only reachable from devDependencies. Development packages are not shipped in the
// website, but a few of them produce files that are (the @fontsource fonts are copied into public/fonts/docx), so the report lists those
// by hand (docs/compliance/THIRD_PARTY_LICENSE_AUDIT.md, section "Assets").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const root = path.resolve(here, arg("--dir") ?? ".");
const label = arg("--label");
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const direct = new Map([...Object.keys(manifest.dependencies ?? {}).map((n) => [n, "dependencies"]), ...Object.keys(manifest.devDependencies ?? {}).map((n) => [n, "devDependencies"])]);

// Licences that are permissive: use in a commercial website, with the notice kept, is allowed (still listed with their obligations).
const PERMISSIVE = /^(MIT|MIT-0|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|Zlib|WTFPL|CC-BY-4\.0|CC-BY-3\.0|OFL-1\.1|MIT\s?\(.*\))$/i;
const WEAK_COPYLEFT = /(LGPL|MPL|EPL|CDDL|CPL)/i;
const STRONG_COPYLEFT = /(^|[^L])(GPL|AGPL|SSPL|EUPL|OSL)/i;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function declared(pkg) {
  if (!pkg) return null;
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license === "object" && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => (typeof l === "string" ? l : l.type)).join(" OR ");
  return null;
}

// Splits "(MIT OR Apache-2.0)" style expressions into the alternatives the user may choose from and the terms that all apply.
function classify(expression) {
  if (!expression) return "no licence declared";
  const e = expression.replace(/[()]/g, " ").trim();
  const ors = e.split(/\s+OR\s+/i);
  const choices = ors.map((o) => o.split(/\s+AND\s+/i).map((x) => x.trim()));
  const allPermissive = (terms) => terms.every((t) => PERMISSIVE.test(t));
  if (choices.some(allPermissive)) return ors.length > 1 ? "permissive (a permissive alternative is offered)" : "permissive";
  if (choices.every((terms) => terms.some((t) => STRONG_COPYLEFT.test(t)))) return "strong copyleft";
  if (choices.some((terms) => terms.some((t) => WEAK_COPYLEFT.test(t)))) return "weak copyleft";
  if (/UNLICENSED|SEE LICENSE|CUSTOM/i.test(e)) return "custom or proprietary: read the file";
  return "other: read the file";
}

const rows = [];
for (const [key, entry] of Object.entries(lock.packages)) {
  if (!key) continue;
  const dir = path.join(root, key);
  const pkg = readJson(path.join(dir, "package.json"));
  const name = key.replace(/^.*node_modules\//, "");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const licenseFiles = files.filter((f) => /^(licen[cs]e|copying|unlicense)/i.test(f));
  const noticeFiles = files.filter((f) => /^notice/i.test(f));
  const expression = declared(pkg) ?? entry.license ?? null;
  rows.push({
    name,
    version: pkg?.version ?? entry.version ?? null,
    path: key,
    direct: direct.get(name) ?? null,
    dev: !!entry.dev,
    optional: !!entry.optional,
    license: expression,
    category: classify(expression),
    licenseFiles,
    noticeFiles,
    repository: typeof pkg?.repository === "string" ? pkg.repository : (pkg?.repository?.url ?? null),
    homepage: pkg?.homepage ?? null,
    installed: !!pkg,
  });
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

const out = path.join(here, "docs", "compliance", label ? `license-inventory-${label}.json` : "license-inventory.json");
// --check only reads: it must never change a committed file
const checkOnly = process.argv.includes("--check");
if (!checkOnly) fs.mkdirSync(path.dirname(out), { recursive: true });
if (!checkOnly) fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), tool: "scripts/license-inventory.mjs", lockfileVersion: lock.lockfileVersion, packages: rows }, null, 1) + "\n");

const count = (list, f) => list.reduce((m, r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1), new Map());
const prod = rows.filter((r) => !r.dev);
console.log(`${path.basename(root)}: ${rows.length} packages (${prod.length} not development-only) ${checkOnly ? "checked" : "written to " + path.relative(here, out)}`);
console.log("by category, production:", Object.fromEntries(count(prod, (r) => r.category)));
console.log("by category, development only:", Object.fromEntries(count(rows.filter((r) => r.dev), (r) => r.category)));
// Licences that have been looked at and decided are listed, with the decision, in docs/compliance/license-review.json ("name" or "prefix*").
// --check fails only for a production package that is neither permissive nor in that file, so a NEW unusual licence stops the check.
const reviewed = readJson(path.join(here, "docs", "compliance", "license-review.json"))?.packages ?? {};
const isReviewed = (name) => Object.keys(reviewed).some((k) => (k.endsWith("*") ? name.startsWith(k.slice(0, -1)) : name === k));
const review = rows.filter((r) => !/^permissive/.test(r.category));
for (const r of review) console.log(`  ${r.dev ? "dev-only (not shipped)" : isReviewed(r.name) ? "reviewed" : "NEEDS REVIEW"}: ${r.name}@${r.version}  ${r.license ?? "(none)"}  -> ${r.category}`);
const open = review.filter((r) => !r.dev && !isReviewed(r.name));
if (process.argv.includes("--check")) {
  console.log(open.length ? `${open.length} production package(s) need a licence review (add them to docs/compliance/license-review.json once decided)` : "no production package needs a licence review");
  if (open.length) process.exit(1);
}
