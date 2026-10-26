// The licence notices and disclosures the site must carry, checked against what is really installed and served:
// the generated notices file covers every production package and every bundled resource, the notice files travel beside the
// assets they cover, the footer links to them, and the privacy policy names the third-party processors the code really calls.
//   node tests/compliance/notices.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const sha = (f) => createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex");
let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL " + name + "\n       " + String(e?.message ?? e).split("\n").slice(0, 6).join("\n       "));
  }
}

// The same steps `npm run build` runs first, so this checks what the build produces.
for (const s of ["copy-pdf-assets", "copy-ocr-assets", "copy-qpdf-assets", "copy-notices"]) execFileSync("node", [path.join(root, "scripts", s + ".mjs")], { cwd: root, stdio: "pipe" });
const notices = read("public/licenses/third-party-notices.txt");

console.log("Notices for files the site serves");
check("the notices file has every part and no missing licence file", () => {
  for (const h of ["PDF.js (Mozilla): /pdfjs", "QuickJS (PDF.js form-scripting engine)", "Tesseract OCR: /ocr", "QPDF engine: /qpdf", "Fonts", "PART 2: NPM PACKAGES"]) assert.ok(notices.includes(h), h);
  assert.ok(!notices.includes("file not present in this build"), "a licence file is missing");
  for (const t of ["Foxit", "QuickJS Javascript Engine", "Copyright (c) 2017-2021 Fabrice Bellard", "Leptonica", "libpng", "giflib", "libtiff", "libwebp", "openlibm", "libjpeg-turbo", "qpdf is copyright", "SIL OPEN FONT LICENSE", "Copyright 2024 The Geist Project Authors"]) assert.ok(notices.includes(t), t);
});
check("every production npm package that is installed is listed with its version", () => {
  const lock = JSON.parse(read("package-lock.json"));
  const missing = [];
  let count = 0;
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || entry.dev) continue;
    const pkgFile = path.join(root, key, "package.json");
    if (!fs.existsSync(pkgFile)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    count++;
    if (!notices.includes(`${key.replace(/^.*node_modules\//, "")}@${pkg.version}`)) missing.push(`${key}@${pkg.version}`);
  }
  assert.deepEqual(missing, []);
  assert.ok(count > 250, `${count} production packages`);
});
check("a package whose installed release declares no licence says so instead of guessing", () => {
  assert.match(notices, /buffers@0\.1\.1\s+no licence declared: the installed release 0\.1\.1 ships no licence file/);
});
check("the notice files travel beside the engines they cover", () => {
  assert.ok(read("public/qpdf/NOTICE.txt").includes("QPDF") && read("public/qpdf/NOTICE.txt").includes("libjpeg-turbo"));
  assert.ok(read("public/ocr/licenses/ocr-core-NOTICE.txt").includes("Leptonica") && read("public/ocr/licenses/ocr-core-NOTICE.txt").includes("4.0.0_best_int"));
  assert.ok(read("public/pdfjs/wasm/LICENSE_QUICKJS.txt").includes("Fabrice Bellard") && read("public/pdfjs/wasm/LICENSE_QUICKJS.txt").includes("Mozilla Foundation"));
});
check("the QuickJS files served are exactly the ones pdfjs-dist ships (the files the notice describes)", () => {
  for (const f of ["quickjs-eval.wasm", "quickjs-eval.js"]) assert.equal(sha(`public/pdfjs/wasm/${f}`), sha(`node_modules/pdfjs-dist/wasm/${f}`), f);
  // PDF.js runs QuickJS only for PDF form scripting; nothing in the application switches that on
  const users = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && /enableScripting/.test(read(rel))) users.push(rel);
    }
  };
  for (const d of ["app", "components", "utils"]) walk(d);
  assert.deepEqual(users, [], "form scripting (the only use of QuickJS) stays off");
});

console.log("Links and disclosures");
check("the footer links to the notices file", () => {
  assert.match(read("components/layout/Footer.tsx"), /href="\/licenses\/third-party-notices\.txt"[\s\S]{0,120}Open-source notices/);
});
check("the privacy policy names the processors the code really calls, with what is sent", () => {
  const policy = read("app/privacy/page.tsx");
  // what the code does
  const assistant = read("utils/assistant/server.ts");
  assert.ok(assistant.includes("https://api.anthropic.com/v1/messages"));
  assert.ok(read("utils/analytics/geoProviders.ts").includes("https://api.ip2location.io/"));
  assert.ok(read("components/analytics/MicrosoftClarity.tsx").includes("https://www.clarity.ms/tag/"));
  // what the policy says
  assert.match(policy, /Anthropic — where AI answers in the “Ask me” help assistant are switched on/);
  assert.match(policy, /up to six earlier messages/);
  assert.match(policy, /IP2Location \(api\.ip2location\.io\)/);
  assert.match(policy, /Microsoft Privacy Statement: https:\/\/www\.microsoft\.com\/privacy\/privacystatement/);
  assert.match(policy, /YouTube or Vimeo/);
  // and the numbers it quotes match the code
  const sanitize = read("utils/assistant/sanitize.ts");
  assert.match(sanitize, /MAX_HISTORY_TURNS = 6/);
  assert.match(sanitize, /\[email removed\]/);
});
check("the policy carries the date of its last change", () => {
  assert.match(read("app/privacy/page.tsx"), /const UPDATED = "October 26, 2026";/);
});

console.log("The inventory");
check("the committed inventory matches package-lock.json and the review list covers every non-permissive production package (read only)", () => {
  const lock = JSON.parse(read("package-lock.json"));
  const inv = JSON.parse(read("docs/compliance/license-inventory.json"));
  assert.equal(inv.packages.length, Object.keys(lock.packages).length - 1);
  const out = execFileSync("node", [path.join(root, "scripts", "license-inventory.mjs"), "--check"], { cwd: root, encoding: "utf8" });
  assert.match(out, /no production package needs a licence review/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
