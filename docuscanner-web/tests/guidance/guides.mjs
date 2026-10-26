// The help content for Create Word Document: the dedicated guide, the links to it from the other guides and pages, and the
// distinctions it draws. Checks the content against the product (routes, labels, limits) so it cannot drift.
//   node --no-warnings --import ./tests/scanner/register.mjs tests/guidance/guides.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDES, getGuide } from "../../utils/seo/guides.ts";
import { getLanding } from "../../utils/seo/landing.ts";
import { isKnownRoute } from "../../utils/assistant/knowledge.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0;
const test = (name, fn) => {
  fn();
  pass++;
  console.log("  ok  " + name);
};
const SLUG = "how-to-create-a-word-document-from-scratch";
const guide = getGuide(SLUG);
const all = (g) => [g.title, g.description, g.h1, g.intro, ...g.sections.flatMap((s) => [s.h2, ...(s.paragraphs ?? []), ...(s.steps ?? []), ...(s.bullets ?? [])])].join("\n");

test("the guide exists with a unique slug and the title people look for", () => {
  assert.ok(guide);
  assert.equal(GUIDES.filter((g) => g.slug === SLUG).length, 1);
  assert.match(guide.h1, /Create a Word document from scratch/i);
});
test("it covers every step of the job, in order", () => {
  const headings = guide.sections.map((s) => s.h2);
  const order = ["Open Create Word Document", "Start a blank document", "Enter a title, headings and body text", "Select text and format it", "Insert pictures and your signature", "How saving and draft recovery work", "Download the finished .docx", "Limits and troubleshooting"];
  let last = -1;
  for (const h of order) {
    const i = headings.indexOf(h);
    assert.ok(i > last, `${h} is missing or out of order`);
    last = i;
  }
});
test("it leads to the real page, and every link in it is a real page", () => {
  assert.equal(guide.tool.href, "/create-word-document");
  assert.ok(isKnownRoute(guide.tool.href));
  assert.ok(fs.existsSync(path.join(root, "app/create-word-document/page.tsx")));
  for (const r of guide.related) {
    if (r.href.startsWith("/guides/")) assert.ok(getGuide(r.href.slice("/guides/".length)), r.href);
    else assert.ok(isKnownRoute(r.href), r.href);
  }
});
test("it names controls that are on the screen", () => {
  const ui = ["components/wordCreator/Toolbar.tsx", "components/wordCreator/WordCreator.tsx", "components/wordCreator/NavPad.tsx"].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  const text = all(guide);
  for (const label of ["Document name", "Insert image", "Add signature", "Save now", "New document", "My drafts", "Download Word (.docx)", "Clear text formatting", "Delete picture"]) {
    assert.ok(text.includes(label), `the guide never mentions ${label}`);
    assert.ok(ui.includes(label), `${label} is not in the interface`);
  }
  const model = fs.readFileSync(path.join(root, "utils/wordCreator/model.ts"), "utf8");
  for (const font of ["Arial", "Times New Roman", "Calibri", "Georgia", "Verdana"]) assert.ok(text.includes(font) && model.includes(font), font);
});
test("it is honest: local drafts, no account, no cloud, real limits", () => {
  const text = all(guide);
  assert.match(text, /not saved to a FreePDFScanner account/);
  assert.match(text, /this browser and this device|this device and in this browser|this browser/);
  assert.match(text, /Tables, headers, footers and page numbers are not available yet/);
  assert.match(text, /not a certified digital signature/);
  assert.match(text, /line and page breaks can move slightly/);
  assert.doesNotMatch(text, /cloud|synced? across|collaborat|spell.?check|real-time|\bAI\b/i);
  assert.doesNotMatch(text, /upload (a|your) PDF to create/i);
});
test("it tells create, convert and extract apart", () => {
  const section = guide.sections.find((s) => s.h2 === "Create, convert or extract text?");
  const text = section.bullets.join(" ");
  assert.match(text, /Create Word Document: write a new document/);
  assert.match(text, /PDF to Word: turn a PDF you already have/);
  assert.match(text, /OCR \(Extract text\)/);
});
test("other guides and pages link to it", () => {
  for (const slug of ["how-to-sign-a-pdf-online", "how-to-extract-text-from-a-scanned-pdf"]) {
    assert.ok(getGuide(slug).related.some((r) => r.href === `/guides/${SLUG}`), slug);
  }
  const landing = getLanding("/create-word-document");
  assert.ok(landing.related.some((r) => r.href === `/guides/${SLUG}`));
  for (const p of ["/convert/pdf-to-word", "/tools/ocr", "/pdf-converter", "/pdf-to-text", "/document-converter", "/convert/word-to-pdf"]) {
    assert.ok(getLanding(p).related.some((r) => r.href === "/create-word-document"), `${p} does not link to Create Word Document`);
  }
  assert.ok(getLanding("/convert/pdf-to-word").faq.some((f) => /new Word document/i.test(f.q)));
  assert.ok(getLanding("/tools/ocr").faq.some((f) => /new Word document/i.test(f.q)));
  assert.match(getLanding("/create-word-document").features.join(" "), /signature/);
});
test("it explains font size, margins, paragraph options, page breaks and writing on a phone, using the real labels and limits", () => {
  const text = all(guide);
  const ui = ["components/wordCreator/Toolbar.tsx", "components/wordCreator/WordCreator.tsx", "components/wordCreator/NavPad.tsx", "components/wordCreator/extensions.ts"].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  for (const label of ["Add page", "Page break", "Apply custom margins", "Show navigation keys", "Increase font size", "Decrease font size", "Zoom", "Fit to screen", "100%", "Paragraph", "More"]) {
    assert.ok(text.includes(label), `the guide never mentions ${label}`);
    assert.ok(ui.includes(label), `${label} is not in the interface`);
  }
  for (const phrase of ["8 to 72 points", "from 1 to 400", "Normal, Narrow, Moderate or Wide", "each from 0.25 to 4", "Ctrl+Enter", "Mixed", "Single, 1.15, 1.5, Double", "first-line or hanging indent", "never re-flowed into a narrower column"]) assert.ok(text.includes(phrase), phrase);
  const headings = guide.sections.map((s) => s.h2);
  assert.ok(headings.includes("Set the page margins and add pages") && headings.includes("Writing on a phone"));
  const model = fs.readFileSync(path.join(root, "utils/wordCreator/model.ts"), "utf8");
  assert.match(model, /FONT_SIZES = \[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72\]/);
  assert.match(model, /MIN_MARGIN_TWIPS = 360/);
  assert.match(model, /MAX_MARGIN_TWIPS = 5760/);
  assert.doesNotMatch(text, /cloud|synced? across|collaborat|\bAI\b|voice|dictat/i);
});
test("the guide is in the sitemap, the guides hub and the pages are built from the same list", () => {
  const sitemap = fs.readFileSync(path.join(root, "app/sitemap.ts"), "utf8");
  assert.ok(/GUIDES/.test(sitemap) && /create-word-document/.test(sitemap), "sitemap lists the guides and the creator page");
  const hub = fs.readFileSync(path.join(root, "app/guides/page.tsx"), "utf8");
  assert.ok(/GUIDES/.test(hub));
});

console.log(`\n${pass} checks passed`);
