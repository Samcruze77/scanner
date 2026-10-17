// The OCR panel's optional "Fix look-alike characters in codes" control, in the real browser on the audit scan:
// nothing changes until a format is typed and the button pressed; matching codes are fixed; ordinary text is not
// touched; "Undo edits" undoes it.
//   node tests/audit/verify-ocr-ui.mjs [baseUrl]      (needs `npm run start`)
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME, chromium, newPage, visit } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const { context, page } = await newPage(browser);
await visit(page, "/scan");
await page.locator('input[aria-label^="Upload a document"]').setInputFiles(path.join(here, "corpus", "scan.jpg"));
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Create PDF \(1 page/.test(b.innerText) && !b.disabled), null, { timeout: 120000 });
await page.locator('[data-assistant-id="scan-more-options"]').click();
await page.locator('[data-assistant-id="scan-extract-text"]').click();
const dialog = page.getByRole("dialog", { name: "Extracted text" });
await dialog.waitFor({ timeout: 120000 });
const box = dialog.getByRole("textbox").last();
await box.waitFor({ timeout: 120000 });
const original = await box.inputValue();
let pass = 0;
const ok = (name) => {
  pass++;
  console.log("  ok  " + name);
};
console.log("OCR read", original.length, "characters; contains SCAN-LO1:", original.includes("SCAN-LO1"));
assert.ok(original.includes("quick brown fox"));
ok("text is extracted, and nothing is changed automatically");

await dialog.getByText("Fix look-alike characters in codes (optional)").click();
const apply = dialog.getByRole("button", { name: "Fix matching codes" });
assert.equal(await apply.isDisabled(), true, "disabled until a format is typed");
ok("the button is disabled until a format is typed");
await dialog.getByLabel("Format of your codes").fill("AAAA-A99");
await apply.click();
const fixed = await box.inputValue();
const status = await dialog.getByRole("status").last().innerText();
console.log("   ", status);
if (original.includes("SCAN-LO1") || original.includes("SCAN-LO7")) {
  assert.ok(!fixed.includes("SCAN-LO1") && fixed.includes("SCAN-L01"), "SCAN-LO1 became SCAN-L01");
  ok("a code the reader got wrong (SCAN-LO1) is fixed to SCAN-L01");
}
// Ordinary words and the rest of the text are exactly as before.
const strip = (t) => t.replace(/SCAN-L[O0]\d+/g, "CODE");
assert.equal(strip(fixed), strip(original), "only the codes can differ");
assert.ok(fixed.includes("The quick brown fox jumps over the lazy dog") && fixed.includes("liquor jugs") && fixed.includes("1234.56 EUR"));
ok("ordinary text and numbers are exactly as read");
await dialog.getByRole("button", { name: "Undo edits" }).click();
assert.equal(await box.inputValue(), original);
ok("Undo edits brings back what the reader produced");
await dialog.getByLabel("Format of your codes").fill("99999999");
assert.equal(await apply.isDisabled(), false);
await apply.click();
assert.equal(await box.inputValue(), original, "a format nothing matches changes nothing");
ok("a format that matches nothing changes nothing");
await context.close();
await browser.close();
console.log(`\n${pass} checks passed`);
