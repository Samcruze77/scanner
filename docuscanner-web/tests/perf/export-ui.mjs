// Admin Exports date control in a real browser against tests/perf/mock-supabase.mjs:
// typing/clearing dates sends no request; Apply sends exactly one; invalid ranges cannot be applied.
//   node tests/perf/export-ui.mjs <cookieFile> [base]
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";

const cookie = fs.readFileSync(process.argv[2], "utf8").trim();
const BASE = (process.argv[3] ?? "http://localhost:3102").replace(/\/$/, "");
const CHROME = [process.env.CHROME, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function run(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: "sb-127-auth-token", value: cookie, url: BASE }]);
  await ctx.addInitScript(() => localStorage.setItem("ds_consent", JSON.stringify({ version: 1, decided_at: "x", analytics: false, advertising: false, recordings: false })));
  const page = await ctx.newPage();
  const api = [];
  page.on("request", (r) => /analytics-export|admin-analytics/.test(r.url()) && !/mode=options/.test(r.url()) && api.push(r.url()));
  await page.goto(BASE + "/admin/exports", { waitUntil: "networkidle" });
  const from = page.getByLabel("Start date");
  const to = page.getByLabel("End date");
  const apply = page.getByRole("button", { name: /^(Apply|Refresh)$/ });
  api.length = 0;

  // Selecting / clearing dates only edits a draft: nothing is requested.
  await from.fill("2026-09-01");
  await to.fill("2026-09-07");
  await from.fill("");
  assert.equal(await apply.isDisabled(), true, "cleared start disables Apply");
  await page.getByText("Choose a start date.").waitFor();
  await from.fill("2026-09-08");
  assert.equal(await apply.isDisabled(), true, "start after end disables Apply");
  await page.getByText(/on or before the end date/).waitFor();
  await page.waitForTimeout(400);
  assert.deepEqual(api, [], "no request while selecting");

  await from.fill("2026-09-01");
  await page.getByText("7 days, both dates included. Days are UTC.").waitFor();
  await apply.click();
  await page.getByText("Report preview").waitFor();
  await page.waitForTimeout(300);
  const summary = api.filter((u) => u.includes("format=summary"));
  assert.equal(summary.length, 1, `one summary request after Apply (got ${summary.length})`);
  assert.match(summary[0], /from=2026-09-01/);
  assert.match(summary[0], /to=2026-09-07/);
  await page.getByText("2,800").first().waitFor();

  await from.fill("2026-09-15");
  await to.fill("2026-09-15");
  await page.getByText("1 day, both dates included. Days are UTC.").waitFor();
  assert.equal(await apply.isEnabled(), true);
  await ctx.close();
}

await run({ width: 1280, height: 800 });
console.log("ok desktop");
await run({ width: 390, height: 844 });
console.log("ok mobile");
await browser.close();
