// Awkward inputs on the main upload paths, in a real browser against a production build:
//   * Protect PDF end to end through the UI, then the DOWNLOADED file checked independently with
//     pdf.js: it must refuse to open with no password and with a wrong password, and open with the
//     right one with the original page count. Short and mismatched passwords must be refused.
//   * that protected PDF, a corrupted PDF, a truncated PDF, an empty file, a file over the size
//     limit and an unsupported type, fed to Scan, PDF -> Word and Compress PDF: each must give a
//     clear message (role=alert), never a crash, a hang, or a fake success.
//   * a file with an unusual name (accents, CJK, symbols) goes through and the download is named
//     sensibly; a dropped file (drag and drop) is accepted by a converter's drop zone.
//
//   node tests/audit/edge-inputs.mjs [baseUrl]     (needs `npm run build && npm run start`)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, newPage, pdfjs, saveDownload, visit, work } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const C = (n) => path.join(here, "corpus", n);
const PASSWORD = "Edge-Case-Pass-2026!";

// ---- fixtures ------------------------------------------------------------------------------------
const report = fs.readFileSync(C("report.pdf"));
const fx = (name, data) => {
  const f = path.join(work, name);
  fs.writeFileSync(f, data);
  return f;
};
const CORRUPT = fx("corrupt.pdf", Buffer.from("%PDF-1.7\n1 0 obj\nthis is not a pdf at all\n%%EOF\n"));
const TRUNCATED = fx("truncated.pdf", report.subarray(0, Math.floor(report.length / 3)));
const EMPTY = fx("empty.pdf", Buffer.alloc(0));
// Over each tool's own limit: Scan and the converters take PDFs up to 25 MB, Compress PDF up to 100 MB.
const HUGE = fx("huge.pdf", Buffer.concat([report, Buffer.alloc(26 * 1024 * 1024, 0x20)]));
const HUGE_COMPRESS = fx("huge-compress.pdf", Buffer.concat([report, Buffer.alloc(101 * 1024 * 1024, 0x20)]));
const UNSUPPORTED = fx("notes.exe", Buffer.from("MZ not really a program"));
const ODD_NAME = fx("Résumé – Q3 (final) #2 名前.pdf", fs.readFileSync(C("text.pdf")));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let passed = 0;
let failed = 0;
const rows = [];
async function test(name, fn) {
  try {
    const note = await fn();
    passed++;
    console.log(`  ✓ ${name}${note ? `  -- ${note}` : ""}`);
    rows.push({ name, ok: true, note });
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(e.message).split("\n")[0]}`);
    rows.push({ name, ok: false, note: e.message });
  }
}

async function openPdf(file, password) {
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), password, isEvalSupported: false });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

// Waits for the tool to answer the upload: an error (role=alert) or a sign it accepted the file.
async function outcome(page, acceptedSelector, timeout = 60000) {
  const alert = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
  const accepted = page.locator(acceptedSelector).first();
  const start = Date.now();
  let seenAccepted = null;
  while (Date.now() - start < timeout) {
    if (await alert.isVisible().catch(() => false)) return { error: (await alert.innerText()).trim() };
    if (await accepted.isVisible().catch(() => false)) {
      seenAccepted ??= Date.now();
      if (Date.now() - seenAccepted > 1500) return { accepted: true };
    }
    await page.waitForTimeout(250);
  }
  return { hang: true };
}

let protectedPdf = null;
console.log(`Edge-case inputs against ${process.argv.find((a) => a.startsWith("http")) ?? "default"}`);

console.log("Protect PDF");
await test("short and mismatched passwords are refused with a message on the field", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/tools/protect-pdf");
  await page.locator('input[type="file"]').setInputFiles(C("report.pdf"));
  await page.locator('input[type="password"]').nth(0).fill("abc");
  await page.locator('input[type="password"]').nth(1).fill("abc");
  await page.locator("[data-assistant-id=protect-submit]").click();
  const short = await page.locator("form").innerText();
  assert.match(short, /at least \d+ characters/i);
  await page.locator('input[type="password"]').nth(0).fill(PASSWORD);
  await page.locator('input[type="password"]').nth(1).fill(PASSWORD + "x");
  await page.locator("[data-assistant-id=protect-submit]").click();
  assert.match(await page.locator("form").innerText(), /match/i);
  await context.close();
});
await test("a protected PDF really is encrypted: no password and a wrong password are refused; the right one opens it", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/tools/protect-pdf");
  await page.locator('input[type="file"]').setInputFiles(C("report.pdf"));
  await page.locator('input[type="password"]').nth(0).fill(PASSWORD);
  await page.locator('input[type="password"]').nth(1).fill(PASSWORD);
  await page.locator("[data-assistant-id=protect-submit]").click();
  const dl = await saveDownload(page, () => page.getByRole("button", { name: /Download protected PDF/ }).click(), "protected.pdf");
  protectedPdf = dl.file;
  const original = await openPdf(C("report.pdf"));
  await assert.rejects(openPdf(dl.file), (e) => e.name === "PasswordException", "opening with no password is refused");
  await assert.rejects(openPdf(dl.file, "wrong-password"), (e) => e.name === "PasswordException", "a wrong password is refused");
  assert.equal(await openPdf(dl.file, PASSWORD), original, "the right password opens all pages");
  await context.close();
  return `${(fs.statSync(dl.file).size / 1024).toFixed(0)} KB, ${original} pages, download named "${dl.suggested}"`;
});

const TARGETS = [
  { route: "/scan", input: 'input[aria-label^="Upload a document"]', accepted: 'ul[aria-label="Pages"] li' },
  { route: "/convert/pdf-to-word", input: 'input[type="file"]', action: "Convert to Word", accepted: 'main button:has-text("Download")' },
  { route: "/tools/compress-pdf", input: 'input[type="file"]', accepted: 'main input[type="range"]', huge: () => HUGE_COMPRESS },
];
const UNREADABLE = /damaged|corrupt|couldn.t|could not|can.t|valid|read|open/i;
const BAD = [
  ["password-protected PDF", () => protectedPdf, /password/i],
  ["corrupted PDF", () => CORRUPT, UNREADABLE],
  ["truncated PDF", () => TRUNCATED, UNREADABLE],
  ["empty (0-byte) file", () => EMPTY, /empty|valid|damaged|couldn.t|could not|can.t|read|open/i],
  ["file over the tool's size limit", null, /large|MB|size|big/i],
  ["unsupported type (.exe)", () => UNSUPPORTED, /support|type|format|choose|can.t|PDF/i],
];
for (const t of TARGETS) {
  console.log(`Bad inputs on ${t.route}`);
  for (const [label, given, expected] of BAD) {
    const file = given ?? t.huge ?? (() => HUGE);
    await test(`${t.route}: ${label} -> a clear message, no crash`, async () => {
      assert.ok(file(), "fixture available");
      const { context, page } = await newPage(browser);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await visit(page, t.route);
      await page.locator(t.input).first().setInputFiles(file());
      if (t.action) {
        // Converters take the file first and read it when you press the action button.
        const action = page.getByRole("button", { name: t.action, exact: true });
        await action.waitFor({ timeout: 10000 }).catch(() => {});
        if (await action.isVisible().catch(() => false)) await action.click();
      }
      const r = await outcome(page, t.accepted);
      await context.close();
      assert.ok(!r.hang, "the page answered (no endless spinner)");
      assert.ok(!r.accepted, "the bad file was not accepted as if it were fine");
      assert.match(r.error, expected, `message explains the problem: "${r.error}"`);
      assert.deepEqual(errors, [], "no uncaught script errors");
      return `"${r.error.slice(0, 110)}"`;
    });
  }
}

console.log("Names and drag and drop");
await test("an unusual file name (accents, dash, #, CJK) converts and the download keeps a readable name", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/convert/pdf-to-word");
  await page.locator('input[type="file"]').setInputFiles(ODD_NAME);
  await page.getByRole("button", { name: "Convert to Word", exact: true }).click();
  const dl = await saveDownload(page, async () => {
    await page.getByRole("button", { name: /Download/ }).first().waitFor({ timeout: 120000 });
    await page.getByRole("button", { name: /Download/ }).first().click();
  }, "odd.docx");
  await context.close();
  assert.equal(fs.readFileSync(dl.file).subarray(0, 2).toString(), "PK", "a real .docx (zip) came out");
  assert.match(dl.suggested, /\.docx$/);
  assert.match(dl.suggested, /Résumé/, `download name keeps the person's own name: "${dl.suggested}"`);
  return `download named "${dl.suggested}"`;
});
await test("a file dropped on a converter's drop zone is accepted (drag and drop)", async () => {
  const { context, page } = await newPage(browser);
  await visit(page, "/convert/pdf-to-word");
  const bytes = [...fs.readFileSync(C("text.pdf"))];
  await page.evaluate((data) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], "dropped.pdf", { type: "application/pdf" }));
    const zone = document.querySelector("[data-assistant-id=file-dropzone]").parentElement;
    for (const type of ["dragenter", "dragover", "drop"]) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, bytes);
  await page.getByText("dropped.pdf").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Convert to Word", exact: true }).click();
  const r = await outcome(page, 'main button:has-text("Download")', 120000);
  await context.close();
  assert.ok(r.accepted, `dropped file processed (${JSON.stringify(r)})`);
});

await browser.close();
fs.writeFileSync(path.join(here, "results-edge-inputs.json"), JSON.stringify(rows, null, 2));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
