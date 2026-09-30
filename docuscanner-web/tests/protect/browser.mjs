// End-to-end tests of Protect PDF / Protect Word in a real browser (Chromium via
// playwright-core), against a running production build.
//
//   NEXT_PUBLIC_DOCX_PROTECTION_ENABLED=true NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-key npm run build && npx next start -p 3100
//   node tests/protect/browser.mjs [baseUrl]        (default http://localhost:3100)
//
// Covers: anonymous and signed-in visitors, desktop / laptop / tablet / mobile layouts,
// the full pick -> password -> protect -> download flow, validation errors, cancellation,
// retry, stale-result protection, what the browser sends over the network (no upload, no
// password, no filename), and that pages which need an account still ask for one.
// Downloads are then checked with independent readers (pdf.js, msoffcrypto-tool).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import JSZip from "jszip";
import sharp from "sharp";
import { makePdf, makeTestDocx, PASSWORD, retypeDocx } from "./fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "protect-e2e-"));
process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));
const CHROME = [process.env.CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chromium found. Set CHROME to a browser executable.");

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const docx = await makeTestDocx();
const pdf = await makePdf();
const files = {
  "contract.docx": docx,
  "report.pdf": pdf,
  "macros.docm": await retypeDocx(docx, (ct) => ct.replace("wordprocessingml.document.main+xml", "wordprocessingml.document.macroEnabled.main+xml")),
  "broken.docx": docx.slice(0, 2500),
  "notes.txt": new TextEncoder().encode("plain text"),
  "empty.docx": new Uint8Array(0),
};
// Pictures for the "picture -> protected one-page PDF" flow.
const photo = { create: { width: 320, height: 200, channels: 3, background: { r: 200, g: 60, b: 40 } } };
files["photo.png"] = new Uint8Array(await sharp(photo).png().toBuffer());
files["photo.jpg"] = new Uint8Array(await sharp(photo).jpeg().toBuffer());
files["photo.webp"] = new Uint8Array(await sharp(photo).webp().toBuffer());
for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(work, name), bytes);
const file = (name) => path.join(work, name);

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1366, height: 768 },
  tablet: { width: 820, height: 1180, hasTouch: true },
  mobile: { width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
let failed = 0;
async function test(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const t = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Date.now() - t} ms)`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(error.stack ?? error).split("\n").slice(0, 5).join("\n     ")}`);
  }
}

// A fresh browser context per scenario. `signedIn` plants a session cookie so the app treats
// the visitor as logged in (the tool must behave identically); `consent` is what the visitor chose.
async function session({ viewport = "desktop", signedIn = false, consent = "reject", slowFirstHash = false } = {}) {
  const { width, height, ...device } = VIEWPORTS[viewport];
  const context = await browser.newContext({ viewport: { width, height }, ...device, acceptDownloads: true });
  const requests = [];
  const consoleMessages = [];
  const analytics = [];
  context.on("request", (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? "" }));
  if (signedIn) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "user@example.com", app_metadata: {}, user_metadata: {}, created_at: "2024-01-01T00:00:00Z" };
    const value = { access_token: `${b64({ alg: "none" })}.${b64({ aud: "authenticated", exp, sub: user.id, role: "authenticated" })}.x`, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user };
    await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`, url: BASE }]);
  }
  await context.addInitScript(([choice]) => {
    // The visitor's stored cookie choice (see utils/consent/consent.ts); analytics only if accepted.
    const state = { version: 1, decided_at: new Date().toISOString(), analytics: choice === "accept", advertising: false, recordings: false };
    try { localStorage.setItem("ds_consent", JSON.stringify(state)); } catch {}
  }, [consent]);
  if (slowFirstHash) {
    // Makes the first round of the password hashing take 4 s, so a run stays in progress long enough
    // to cancel or interrupt deterministically (instead of depending on machine speed).
    await context.addInitScript(() => {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      let first = true;
      crypto.subtle.digest = async (...args) => {
        // 68 bytes = one round of the password hashing loop (4-byte counter + 64-byte hash).
        if (first && args[1] && args[1].byteLength === 68) {
          first = false;
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
        return original(...args);
      };
    });
  }
  await context.route("**/api/analytics/track", async (route) => {
    analytics.push(route.request().postData() ?? "");
    await route.fulfill({ status: 202, body: '{"ok":true}', contentType: "application/json" });
  });
  const page = await context.newPage();
  page.on("console", (m) => consoleMessages.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => consoleMessages.push(`pageerror: ${e.message}`));
  return { context, page, requests, consoleMessages, analytics };
}

async function open(page, slug) {
  await page.goto(`${BASE}/tools/${slug}`, { waitUntil: "networkidle" });
  await page.locator("h1").waitFor();
}
const choose = (page, name) => page.locator('input[type="file"]').setInputFiles(file(name));
async function fillPasswords(page, pw, confirm = pw) {
  await page.getByLabel(/^Password to open/).fill(pw);
  await page.getByLabel("Confirm password", { exact: true }).fill(confirm);
}
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal scroll");
const downloadOf = async (page, buttonName) => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: buttonName }).click()]);
  const target = path.join(work, `dl-${crypto.randomUUID()}-${download.suggestedFilename()}`);
  await download.saveAs(target);
  return { name: download.suggestedFilename(), bytes: new Uint8Array(fs.readFileSync(target)), target };
};

const hasPython = spawnSync("python3", ["-c", "import msoffcrypto"]).status === 0;
function msoffDecrypt(target, password) {
  const script = `import msoffcrypto,sys,io\no=msoffcrypto.OfficeFile(open(sys.argv[1],"rb"));print("ENCRYPTED" if o.is_encrypted() else "PLAIN")\no.load_key(password=sys.argv[2]);out=io.BytesIO();o.decrypt(out);sys.stdout.buffer.write(out.getvalue())`;
  return spawnSync("python3", ["-c", script, target, password], { maxBuffer: 256 * 1024 * 1024 });
}
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

// ------------------------------------------------------------------------------------------

await test("anonymous: Word page loads with no sign-in wall and says what it does", async () => {
  const s = await session();
  await open(s.page, "protect-word");
  assert.match(await s.page.locator("h1").innerText(), /Word document/i);
  await s.page.getByText("No account needed").waitFor();
  assert.equal(await s.page.getByRole("dialog").count(), 0, "no login dialog");
  assert.match(await s.page.title(), /Password protect a Word document/i);
  assert.ok((await s.page.locator('meta[name="description"]').getAttribute("content")).length > 50);
  assert.match(await s.page.locator('link[rel="canonical"]').getAttribute("href"), /\/tools\/protect-word$/);
  await s.context.close();
});

await test("anonymous: full Word flow -> download opens only with the password", async () => {
  const s = await session();
  await open(s.page, "protect-word");
  await choose(s.page, "contract.docx");
  await s.page.getByText("contract.docx").waitFor();
  await s.page.getByText("Your Word document will be encrypted and require this password to open in Microsoft Word.").waitFor();
  await s.page.getByText("never sees it and cannot recover it").waitFor();
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect Word document" }).click();
  await s.page.getByText("Your Word document is protected").waitFor({ timeout: 120000 });
  const got = await downloadOf(s.page, /Download protected Word document/);
  assert.equal(got.name, "contract-protected.docx");
  assert.equal(String.fromCharCode(got.bytes[0], got.bytes[1]) !== "PK", true, "not a zip");
  assert.deepEqual([...got.bytes.slice(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (hasPython) {
    const ok = msoffDecrypt(got.target, PASSWORD);
    assert.equal(ok.status, 0, String(ok.stderr));
    const out = ok.stdout.subarray(ok.stdout.indexOf(10) + 1);
    assert.equal(sha(out), sha(docx), "decrypted download equals the original document");
    assert.notEqual(msoffDecrypt(got.target, "wrong password").status, 0);
  }
  // Nothing was uploaded and the password/file/name never crossed the network.
  const external = s.requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !r.url.includes("127.0.0.1:54321"));
  assert.deepEqual(external.map((r) => r.url), [], "no third-party requests");
  for (const r of s.requests) {
    assert.ok(!r.body.includes(PASSWORD) && !r.url.includes(encodeURIComponent(PASSWORD)) && !r.url.includes("contract"), `leak in ${r.method} ${r.url}`);
    assert.ok(r.method === "GET" || r.method === "HEAD" || r.url.includes("/api/analytics") || r.url.includes("127.0.0.1:54321") || r.body.length < 2000, `unexpected upload ${r.method} ${r.url}`);
  }
  assert.ok(!s.consoleMessages.some((m) => m.includes(PASSWORD)), "password in console");
  const stored = await s.page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, u: location.href }));
  assert.ok(!stored.includes(PASSWORD), "password in storage/cookies/URL");
  await s.context.close();
});

await test("anonymous: full PDF flow -> download needs the password (pdf.js)", async () => {
  const s = await session();
  await open(s.page, "protect-pdf");
  await choose(s.page, "report.pdf");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect PDF" }).click();
  await s.page.getByText("Your PDF is protected").waitFor({ timeout: 60000 });
  const got = await downloadOf(s.page, /Download protected PDF/);
  assert.equal(got.name, "report-protected.pdf");
  await assert.rejects(pdfjs.getDocument({ data: got.bytes.slice(), verbosity: 0 }).promise, (e) => e.name === "PasswordException");
  await pdfjs.getDocument({ data: got.bytes.slice(), password: PASSWORD, verbosity: 0 }).promise;
  assert.deepEqual(s.requests.filter((r) => r.method !== "GET").filter((r) => !r.url.includes("/api/analytics")).map((r) => r.url), [], "no uploads");
  await s.context.close();
});

for (const image of ["photo.png", "photo.jpg", "photo.webp"]) {
  await test(`picture (${image}) -> protected one-page PDF that needs the password`, async () => {
    const s = await session();
    await open(s.page, "protect-pdf");
    await choose(s.page, image);
    await fillPasswords(s.page, PASSWORD);
    await s.page.getByRole("button", { name: "Protect PDF" }).click();
    await s.page.getByText("Your picture is protected").waitFor({ timeout: 60000 });
    const got = await downloadOf(s.page, /Download protected PDF/);
    assert.equal(got.name, `${image.split(".")[0]}-protected.pdf`);
    await assert.rejects(pdfjs.getDocument({ data: got.bytes.slice(), verbosity: 0 }).promise, (e) => e.name === "PasswordException");
    const doc = await pdfjs.getDocument({ data: got.bytes.slice(), password: PASSWORD, verbosity: 0 }).promise;
    assert.equal(doc.numPages, 1);
    assert.deepEqual(s.requests.filter((r) => r.method !== "GET").filter((r) => !r.url.includes("/api/analytics")).map((r) => r.url), [], "no uploads");
    await s.context.close();
  });
}

await test("signed-in visitor: the same Word flow works (no difference, no extra prompts)", async () => {
  const s = await session({ signedIn: true });
  await open(s.page, "protect-word");
  await choose(s.page, "contract.docx");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect Word document" }).click();
  await s.page.getByText("Your Word document is protected").waitFor({ timeout: 120000 });
  const got = await downloadOf(s.page, /Download protected Word document/);
  assert.equal(got.name, "contract-protected.docx");
  await s.context.close();
});

// Passwords typed into the real input on the live page, then the DOWNLOADED file checked with
// an independent Office decryptor (msoffcrypto-tool): correct password opens, wrong one fails.
const TYPED_PASSWORDS = { ascii: PASSWORD, accented: "Pässwörd-Ọlájídé-ñ-2024", beyondLatin1: "密码-пароль-🔐-Ωmega-\u{1D11E}" };
for (const [label, typed] of Object.entries(TYPED_PASSWORDS)) {
  await test(`live page, ${label} password: download decrypts to the original with msoffcrypto-tool; wrong and empty passwords fail`, async () => {
    const s = await session();
    await open(s.page, "protect-word");
    await choose(s.page, "contract.docx");
    await fillPasswords(s.page, typed);
    await s.page.getByRole("button", { name: "Protect Word document" }).click();
    await s.page.getByText("Your Word document is protected").waitFor({ timeout: 120000 });
    const got = await downloadOf(s.page, /Download protected Word document/);
    if (hasPython) {
      const ok = msoffDecrypt(got.target, typed);
      assert.equal(ok.status, 0, String(ok.stderr));
      assert.equal(sha(ok.stdout.subarray(ok.stdout.indexOf(10) + 1)), sha(docx));
      assert.notEqual(msoffDecrypt(got.target, typed + "x").status, 0);
      assert.notEqual(msoffDecrypt(got.target, "").status, 0);
    }
    assert.equal(await s.page.getByLabel(/^Password to open/).count(), 0, "passwords are not left in a form");
    await s.context.close();
  });
}

if (process.env.LARGE) {
  await test("live page, ~48 MB document: protects, offers the download, decrypts to the identical original", async () => {
    const big = path.join(work, "large.docx");
    const { makeLargeDocx } = await import("./fixtures.mjs");
    const bytes = await makeLargeDocx(47.4);
    fs.writeFileSync(big, bytes);
    const s = await session();
    await open(s.page, "protect-word");
    const t0 = Date.now();
    await s.page.locator('input[type="file"]').setInputFiles(big);
    await fillPasswords(s.page, PASSWORD);
    await s.page.getByRole("button", { name: "Protect Word document" }).click();
    await s.page.getByText("Your Word document is protected").waitFor({ timeout: 300000 });
    console.log(`     ${(bytes.length / 1048576).toFixed(1)} MB protected in ${Date.now() - t0} ms (select + protect + verify)`);
    const got = await downloadOf(s.page, /Download protected Word document/);
    if (hasPython) {
      const ok = msoffDecrypt(got.target, PASSWORD);
      assert.equal(ok.status, 0, String(ok.stderr));
      assert.equal(sha(ok.stdout.subarray(ok.stdout.indexOf(10) + 1)), sha(bytes));
    }
    await s.context.close();
  });
}

await test("validation: missing password, missing confirmation, mismatch, short password", async () => {
  const s = await session();
  await open(s.page, "protect-word");
  await choose(s.page, "contract.docx");
  const go = () => s.page.getByRole("button", { name: "Protect Word document" }).click();
  await go();
  await s.page.getByText("Enter a password.").waitFor();
  await s.page.getByLabel(/^Password to open/).fill(PASSWORD);
  await go();
  await s.page.getByText("Confirm your password.").waitFor();
  await fillPasswords(s.page, PASSWORD, "Different-Password-1");
  await go();
  await s.page.getByText("The two passwords don't match.").waitFor();
  await fillPasswords(s.page, "abc");
  await go();
  await s.page.getByText("Use at least 6 characters.").waitFor();
  assert.equal(await s.page.getByText(/^Your .* is protected$/).count(), 0);
  await s.context.close();
});

await test("bad files: .docm, corrupt .docx, unsupported type and empty file are refused with clear messages", async () => {
  const s = await session();
  await open(s.page, "protect-word");
  for (const [name, message] of [
    ["macros.docm", /Macro-enabled Word files \(\.docm\) aren't supported/],
    ["broken.docx", /couldn't be read/],
    ["notes.txt", /file type isn't supported/],
    ["empty.docx", /couldn't be read/],
  ]) {
    await choose(s.page, name);
    await s.page.getByRole("alert").filter({ hasText: message }).waitFor();
    assert.equal(await s.page.getByRole("button", { name: /^Protect/ }).count(), 0, `${name}: no Protect button for a refused file`);
    await s.page.getByRole("button", { name: "Dismiss error" }).click();
  }
  await s.context.close();
});

await test("cancel, then retry: cancellation is never success; the next run is fresh and downloads its own result", async () => {
  const s = await session({ slowFirstHash: true });
  await open(s.page, "protect-word");
  await choose(s.page, "contract.docx");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect Word document" }).click();
  await s.page.getByRole("button", { name: "Cancel" }).click();
  await s.page.getByText("Protection cancelled. Your original document is unchanged.").waitFor();
  assert.equal(await s.page.getByText(/^Your .* is protected$/).count(), 0);
  assert.equal(await s.page.getByRole("button", { name: /^Download/ }).count(), 0, "no download after cancel");
  assert.equal(await s.page.getByText("contract.docx").count() > 0, true, "original still selected");
  assert.equal(await s.page.getByLabel(/^Password to open/).inputValue(), "", "password cleared after the run ended");
  await fillPasswords(s.page, "Second-Attempt-Pass-2");
  await s.page.getByRole("button", { name: "Protect Word document" }).click();
  await s.page.getByText("Your Word document is protected").waitFor({ timeout: 120000 });
  const got = await downloadOf(s.page, /Download protected Word document/);
  if (hasPython) {
    assert.notEqual(msoffDecrypt(got.target, PASSWORD).status, 0, "the cancelled attempt's password must not open it");
    assert.equal(msoffDecrypt(got.target, "Second-Attempt-Pass-2").status, 0);
  }
  await s.context.close();
});

await test("no stale download: a success followed by a failed run offers no download", async () => {
  const s = await session();
  await open(s.page, "protect-word");
  await choose(s.page, "contract.docx");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect Word document" }).click();
  await s.page.getByText("Your Word document is protected").waitFor({ timeout: 120000 });
  await s.page.getByRole("button", { name: "Protect another file" }).click();
  // Second run fails: the PDF engine file cannot be loaded.
  await s.page.route("**/qpdf/qpdf.wasm", (route) => route.abort());
  await choose(s.page, "report.pdf");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect PDF" }).click();
  await s.page.getByRole("alert").filter({ hasText: "We couldn't protect this document. Your original file is unchanged. Please try again." }).waitFor({ timeout: 60000 });
  assert.equal(await s.page.getByRole("button", { name: /^Download/ }).count(), 0, "the earlier result is gone");
  assert.equal(await s.page.getByText(/^Your .* is protected$/).count(), 0);
  // Retry without reloading, with the engine available again.
  await s.page.unroute("**/qpdf/qpdf.wasm");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect PDF" }).click();
  await s.page.getByText("Your PDF is protected").waitFor({ timeout: 60000 });
  const got = await downloadOf(s.page, /Download protected PDF/);
  assert.equal(got.name, "report-protected.pdf");
  await s.context.close();
});

await test("download failure keeps the verified result so it can be retried", async () => {
  const s = await session();
  await open(s.page, "protect-pdf");
  await choose(s.page, "report.pdf");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect PDF" }).click();
  await s.page.getByText("Your PDF is protected").waitFor({ timeout: 60000 });
  await s.page.evaluate(() => { const original = URL.createObjectURL; window.__fail = true; URL.createObjectURL = (...a) => { if (window.__fail) throw new Error("boom"); return original(...a); }; });
  await s.page.getByRole("button", { name: /Download protected PDF/ }).click();
  await s.page.getByRole("alert").filter({ hasText: "We couldn't start the download. Please try again." }).waitFor();
  await s.page.evaluate(() => { window.__fail = false; });
  const got = await downloadOf(s.page, /Download protected PDF/);
  await pdfjs.getDocument({ data: got.bytes.slice(), password: PASSWORD, verbosity: 0 }).promise;
  await s.context.close();
});

await test("refreshing mid-run leaves the original file on disk untouched", async () => {
  const before = sha(fs.readFileSync(file("contract.docx")));
  const s = await session({ slowFirstHash: true });
  await open(s.page, "protect-word");
  await choose(s.page, "contract.docx");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect Word document" }).click();
  await s.page.getByRole("button", { name: "Cancel" }).waitFor();
  await s.page.reload({ waitUntil: "networkidle" });
  await s.page.getByText("Choose a Word document to protect").waitFor();
  assert.equal(sha(fs.readFileSync(file("contract.docx"))), before);
  await s.context.close();
});

await test("analytics (consent given): only kind, timing and codes; never a password or filename", async () => {
  const s = await session({ consent: "accept" });
  await open(s.page, "protect-word");
  await choose(s.page, "contract.docx");
  await fillPasswords(s.page, PASSWORD);
  await s.page.getByRole("button", { name: "Protect Word document" }).click();
  await s.page.getByText("Your Word document is protected").waitFor({ timeout: 120000 });
  const all = s.analytics.join("\n");
  assert.ok(/protect_pdf/.test(all), "protect events are sent when the visitor opted in");
  assert.ok(!all.includes(PASSWORD) && !/contract|\.docx|password/i.test(all.replace(/"event_name":"[^"]*"/g, "")), all);
  await s.context.close();
});

await test("account-only pages still require an account (auth not weakened)", async () => {
  const s = await session();
  await s.page.goto(`${BASE}/history`, { waitUntil: "networkidle" });
  assert.ok(/sign in|log in|create.*account/i.test(await s.page.locator("main").innerText()), "history asks for sign-in");
  const admin = await s.page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  assert.ok(!/admin dashboard|users|analytics/i.test(await s.page.locator("body").innerText()) || admin.url() !== `${BASE}/admin`, "admin is not open to anonymous visitors");
  await s.context.close();
});

await test("discoverable: sitemap lists the Protect pages; robots allows them; pages are in the tools hub", async () => {
  const s = await session();
  const sitemap = await (await s.context.request.get(`${BASE}/sitemap.xml`)).text();
  assert.match(sitemap, /\/tools\/protect-pdf/);
  assert.match(sitemap, /\/tools\/protect-word/);
  const robots = await (await s.context.request.get(`${BASE}/robots.txt`)).text();
  assert.ok(!/Disallow:\s*\/tools/.test(robots));
  await s.page.goto(`${BASE}/tools`, { waitUntil: "networkidle" });
  await s.page.getByRole("link", { name: /Protect Word Document/ }).waitFor();
  const r = await s.context.request.get(`${BASE}/lock-pdf`, { maxRedirects: 0 });
  assert.equal(r.status(), 308);
  await s.context.close();
});

for (const [name] of Object.entries(VIEWPORTS)) {
  await test(`responsive (${name}): every step fits without sideways scroll and controls are reachable`, async () => {
    const s = await session({ viewport: name });
    await open(s.page, "protect-word");
    await noOverflow(s.page);
    await choose(s.page, "contract.docx");
    await s.page.getByLabel(/^Password to open/).waitFor();
    await noOverflow(s.page);
    await fillPasswords(s.page, "short", "other");
    await s.page.getByRole("button", { name: "Protect Word document" }).click(); // shows errors
    await noOverflow(s.page);
    const button = s.page.getByRole("button", { name: "Protect Word document" });
    await button.scrollIntoViewIfNeeded();
    await s.page.waitForTimeout(400); // let the layout and any scroll settle
    assert.equal(await s.page.evaluate(() => innerWidth), VIEWPORTS[name].width, "the page really is at this viewport width");
    const box = await button.boundingBox();
    assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= VIEWPORTS[name].width, `CTA size/position ${JSON.stringify(box)} ${JSON.stringify(await s.page.evaluate(() => ({ iw: innerWidth, sx: scrollX, sw: document.documentElement.scrollWidth, vv: visualViewport.scale })))}`);
    await fillPasswords(s.page, PASSWORD);
    await button.click();
    await s.page.getByRole("button", { name: "Cancel" }).waitFor();
    await noOverflow(s.page);
    await s.page.getByText("Your Word document is protected").waitFor({ timeout: 120000 });
    await noOverflow(s.page);
    const dl = await s.page.getByRole("button", { name: /Download protected Word document/ }).boundingBox();
    assert.ok(dl.height >= 44 && dl.x + dl.width <= VIEWPORTS[name].width);
    await s.page.screenshot({ path: path.join(here, "out", `protect-${name}.png`), fullPage: true }).catch(() => {});
    await s.context.close();
  });
}

await test("other tools still load without console errors (bundler alias regression)", async () => {
  const s = await session();
  for (const slug of ["compress-pdf", "ocr", "sign-pdf"]) {
    await open(s.page, slug);
    await s.page.locator("h1").waitFor();
  }
  await s.page.goto(`${BASE}/convert/word-to-pdf`, { waitUntil: "networkidle" });
  const errors = s.consoleMessages.filter((m) => /^(error|pageerror)/.test(m) && !/127\.0\.0\.1:54321|Failed to load resource|net::ERR|supabase/i.test(m));
  assert.deepEqual(errors, []);
  await s.context.close();
});

await browser.close();
console.log(failed ? `\n${failed} browser test(s) FAILED` : "\nAll browser tests passed");
process.exit(failed ? 1 : 0);
