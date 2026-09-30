// Rollback state: the app built WITHOUT NEXT_PUBLIC_DOCX_PROTECTION_ENABLED. Checks that the
// Word option, page, sitemap entry and redirects are gone while Protect PDF and the other
// tools still work. Run against a build made without the flag (server on :3101):
//   node tests/protect/browser-off.mjs [baseUrl]

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { makePdf, makeTestDocx, PASSWORD } from "./fixtures.mjs";

const BASE = (process.argv[2] ?? "http://localhost:3101").replace(/\/$/, "");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "protect-off-"));
process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));
fs.writeFileSync(path.join(work, "a.pdf"), await makePdf());
fs.writeFileSync(path.join(work, "a.docx"), await makeTestDocx());
const CHROME = [process.env.CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.stack ?? e).split("\n").slice(0, 4).join("\n     ")}`);
  }
}
const newPage = async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem("ds_consent", JSON.stringify({ version: 1, decided_at: "x", analytics: false, advertising: false, recordings: false })));
  return { context, page: await context.newPage() };
};

await test("Word page, redirects and sitemap entry are gone", async () => {
  const { context, page } = await newPage();
  for (const url of ["/tools/protect-word", "/tools/protect-excel", "/tools/protect-powerpoint", "/protect-word-document", "/password-protect-word-document", "/protect-excel", "/protect-powerpoint"]) {
    assert.equal((await context.request.get(BASE + url, { maxRedirects: 0 })).status(), 404, url);
  }
  const sitemap = await (await context.request.get(`${BASE}/sitemap.xml`)).text();
  assert.ok(!/protect-(word|excel|powerpoint)/.test(sitemap) && /protect-pdf/.test(sitemap));
  await page.goto(`${BASE}/tools`, { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("link", { name: /Protect Word/ }).count(), 0);
  assert.ok(!/protect-(word|excel|powerpoint)/.test(await page.content()), "no link to the disabled page on the hub or in the footer");
  await context.close();
});

await test("Protect PDF page does not offer or accept Word documents", async () => {
  const { context, page } = await newPage();
  await page.goto(`${BASE}/tools/protect-pdf`, { waitUntil: "networkidle" });
  assert.ok(!/Word document \(\.docx\)/.test(await page.locator("main").innerText()));
  assert.ok(!/docx/.test(await page.locator('input[type="file"]').getAttribute("accept")));
  await page.locator('input[type="file"]').setInputFiles(path.join(work, "a.docx"));
  await page.getByRole("alert").filter({ hasText: "file type isn't supported" }).waitFor();
  await context.close();
});

await test("Protect PDF still works end to end (anonymous, no upload)", async () => {
  const { context, page } = await newPage();
  const requests = [];
  context.on("request", (r) => requests.push(r));
  await page.goto(`${BASE}/tools/protect-pdf`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles(path.join(work, "a.pdf"));
  await page.getByLabel(/^Password to open/).fill(PASSWORD);
  await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Protect PDF" }).click();
  await page.getByText("Your PDF is protected").waitFor({ timeout: 60000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download protected PDF/ }).click()]);
  const target = path.join(work, "out.pdf");
  await download.saveAs(target);
  const bytes = new Uint8Array(fs.readFileSync(target));
  await assert.rejects(pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise, (e) => e.name === "PasswordException");
  await pdfjs.getDocument({ data: bytes.slice(), password: PASSWORD, verbosity: 0 }).promise;
  assert.deepEqual(requests.filter((r) => r.method() !== "GET").map((r) => r.url()), []);
  await context.close();
});

await test("other tools still load without errors", async () => {
  const { context, page } = await newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR|127\.0\.0\.1:54321|supabase/i.test(m.text()) && errors.push(m.text()));
  for (const url of ["/", "/tools", "/tools/compress-pdf", "/tools/ocr", "/tools/sign-pdf", "/convert/word-to-pdf", "/scan"]) await page.goto(BASE + url, { waitUntil: "networkidle" });
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nAll rollback-state tests passed");
process.exit(failed ? 1 : 0);
