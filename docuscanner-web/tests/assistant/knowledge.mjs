// Checks that the help assistant only says true things about FreePDFScanner:
//  - every route it links to is a real page (from the same registries the site uses)
//  - every control it can point at (data-assistant-id) really exists in the source
//  - every suggested question has a real answer behind it
//  - representative questions get the right tool, tailored to the page, with honest limits
//  - the model-answer sanitizer and input validator behave
//   node tests/assistant/knowledge.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGuideAnswer, rankEntries } from "../../utils/assistant/guide.ts";
import {
  allRoutes,
  describePage,
  ENTRY_LIST,
  entriesToPrompt,
  getEntry,
  isKnownRoute,
  stepsFor,
  suggestionsFor,
} from "../../utils/assistant/knowledge.ts";
import { sanitizeAnswer, scrub, validateChatRequest } from "../../utils/assistant/sanitize.ts";
import { CONVERT_TOOLS } from "../../components/convert/tools.ts";
import { TOOLS } from "../../utils/tools/registry.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0;
const test = (name, fn) => {
  fn();
  pass++;
  console.log("  ok  " + name);
};

// ---- ids present in the source ---------------------------------------------------------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "tests"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}
const sourceIds = new Set();
for (const dir of ["app", "components"]) {
  for (const file of walk(path.join(root, dir))) {
    const text = fs.readFileSync(file, "utf8");
    // `data-assistant-id="x"` in JSX, or `"data-assistant-id": "x"` where it is passed to a button helper as a prop.
    for (const m of text.matchAll(/data-assistant-id"?(?:=|:\s*)"([a-z0-9-]+)"/g)) sourceIds.add(m[1]);
  }
}
// Ids built from a template in the source.
for (const item of ["scan", "convert", "tools", "history"]) sourceIds.add(`nav-${item}`);
sourceIds.add("nav-home");
const editorSource = fs.readFileSync(path.join(root, "components/scanner/AnnotationEditor.tsx"), "utf8");
for (const m of editorSource.matchAll(/\{ value: "([a-z]+)", label:/g)) sourceIds.add(`annotation-tool-${m[1]}`);

console.log("Product knowledge matches the product");
test("every entry has an id, title and summary, and ids are unique", () => {
  const ids = ENTRY_LIST.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of ENTRY_LIST) assert.ok(e.id && e.title && e.summary, e.id);
});
test("every route an entry links to is a real page", () => {
  for (const e of ENTRY_LIST) if (e.route) assert.ok(isKnownRoute(e.route), `${e.id}: ${e.route}`);
});
test("every control the assistant can point at exists in the source", () => {
  for (const e of ENTRY_LIST) {
    const all = [...(e.steps ?? []), ...(e.variants ?? []).flatMap((v) => v.steps)];
    for (const s of all) if (s.target) assert.ok(sourceIds.has(s.target), `${e.id}: control "${s.target}" is not in the source`);
  }
});
test("variants only name real pages", () => {
  for (const e of ENTRY_LIST)
    for (const v of e.variants ?? [])
      for (const p of v.pages) {
        const known = isKnownRoute(p) || ["/word-to-pdf", "/protect-pdf", "/lock-pdf", "/password-protect-pdf", "/edit-pdf", "/scan-to-pdf", "/jpg-to-pdf", "/png-to-pdf"].includes(p);
        assert.ok(known, `${e.id}: ${p}`);
      }
});
test("the tool list the assistant knows is the real registry", () => {
  const catalog = getEntry("all-tools").notes.join(" ");
  for (const t of TOOLS) assert.ok(catalog.includes(`/tools/${t.slug}`), t.slug);
  for (const c of CONVERT_TOOLS) assert.ok(catalog.includes(c.href), c.href);
  assert.ok(allRoutes().length >= TOOLS.length + CONVERT_TOOLS.length);
});
test("the Edit Image tool the assistant describes is real and honest about its limits", () => {
  assert.ok(TOOLS.some((t) => t.slug === "edit-image" && t.kind === "image-edit"));
  const e = getEntry("edit-image");
  assert.equal(e.route, "/tools/edit-image");
  assert.equal(rankEntries("how do I crop a photo", "/")[0]?.entry.id, "edit-image");
  assert.equal(rankEntries("resize an image in pixels", "/")[0]?.entry.id, "edit-image");
  assert.equal(rankEntries("how do I put my logo on a pdf", "/")[0]?.entry.id, "insert-image");
  const text = [...e.steps.map((s) => s.text), ...e.notes].join(" ");
  assert.match(text, /not a PDF/);
  assert.match(text, /JPEG, PNG or WebP/);
  assert.doesNotMatch(text, /AVIF|TIFF|BMP|AI |filter/i, "only describe what is implemented");
});
test("editing help (move page, zoom, arrows, picture crop and restore, finishing) matches real controls", () => {
  const top1 = (q, p = "/scan") => rankEntries(q, p, 1)[0]?.entry.id;
  assert.equal(top1("how do I zoom in on the page"), "move-zoom-editor");
  assert.equal(top1("how do I pinch to zoom"), "move-zoom-editor");
  assert.equal(top1("how do I move my signature a little"), "position-with-arrows");
  assert.equal(top1("move text with arrow keys"), "position-with-arrows");
  assert.equal(top1("how do I crop the picture I added"), "crop-restore-image");
  assert.equal(top1("restore original image"), "crop-restore-image");
  assert.equal(top1("I finished editing what next"), "finish-and-download");
  assert.equal(top1("how do I download my edited pdf"), "finish-and-download");
  assert.equal(top1("turn off tips", "/"), "help-tips");
  // The names it tells people to look for are the labels on screen.
  const editor = fs.readFileSync(path.join(root, "components/scanner/AnnotationEditor.tsx"), "utf8");
  const dialog = fs.readFileSync(path.join(root, "components/scanner/ImageEditDialog.tsx"), "utf8");
  const workspace = fs.readFileSync(path.join(root, "components/scanner/ScannerWorkspace.tsx"), "utf8");
  for (const label of ["Move page", "Done editing", "Edit image", "Restore original", "Smaller", "Larger"]) assert.ok(editor.includes(label), label);
  for (const label of ["Reset crop", "Restore original", "Reset size"]) assert.ok(dialog.includes(label), label);
  for (const label of ["Create PDF", "Download PDF", "Download started"]) assert.ok(workspace.includes(label), label);
  // It does not claim features that were not built.
  const text = ["move-zoom-editor", "position-with-arrows", "crop-restore-image", "finish-and-download"].map((id) => entriesToPrompt([getEntry(id)], "/")).join(" ");
  assert.doesNotMatch(text, /AI|automatic(ally)? (crop|enhance)|upload(ed)? to our/i);
});
test("the Add Image tool the assistant sends people to is real", () => {
  assert.ok(TOOLS.some((t) => t.slug === "add-image"));
  assert.equal(getEntry("insert-image").route, "/tools/add-image");
});

console.log("Suggestions");
test("the six example questions exist and each leads to a real answer", () => {
  const asked = suggestionsFor("/").map((s) => s.text);
  for (const q of [
    "How do I convert a Word document to PDF?",
    "How do I insert my passport photograph?",
    "How do I combine multiple PDFs?",
    "How do I protect a PDF with a password?",
    "Where can I find my download?",
    "How do I use the scanner?",
  ]) assert.ok(asked.includes(q), q);
});
test("every suggestion on every kind of page maps to an entry that answers it", () => {
  const pages = ["/", "/scan", "/tools", "/convert", "/tools/pdf-editor", "/tools/add-image", "/tools/protect-pdf", "/convert/word-to-pdf", "/convert/image-to-pdf", "/history", "/privacy"];
  for (const p of pages)
    for (const s of suggestionsFor(p)) {
      assert.ok(getEntry(s.entryId), `${p}: ${s.text}`);
      assert.equal(rankEntries(s.text, p, 1)[0]?.entry.id === s.entryId || buildGuideAnswer(s.text, p).matched, true, `${p}: "${s.text}" has no answer`);
    }
});

console.log("Answers to representative questions");
const top = (q, p = "/") => rankEntries(q, p, 1)[0]?.entry.id;
test("tools and tasks go to the right entry", () => {
  assert.equal(top("How do I convert a Word document to PDF?"), "convert-word-to-pdf");
  assert.equal(top("how do i turn a pdf into word"), "convert-pdf-to-word");
  assert.equal(top("How do I insert my passport photograph?"), "insert-image");
  assert.equal(top("how do I put my logo on a pdf"), "insert-image");
  assert.equal(top("How do I combine multiple PDFs?"), "combine-pdfs");
  assert.equal(top("merge two pdf files"), "combine-pdfs");
  assert.equal(top("How do I protect a PDF with a password?"), "protect-pdf");
  assert.equal(top("Where can I find my download?"), "find-download");
  assert.equal(top("How do I use the scanner?"), "use-scanner");
  assert.equal(top("how to sign a pdf"), "sign-pdf");
  assert.equal(top("my pdf file is too big to email"), "compress-pdf");
  assert.equal(top("how do I extract text from a scanned page"), "ocr");
  assert.equal(top("camera permission denied"), "troubleshoot-camera");
  assert.equal(top("is my document uploaded anywhere"), "privacy");
  assert.equal(top("how do I switch to dark mode"), "themes");
});
test("answers link to the tool and give steps", () => {
  const a = buildGuideAnswer("How do I convert a Word document to PDF?", "/");
  assert.ok(a.matched);
  assert.ok(a.links.some((l) => l.href === "/convert/word-to-pdf"));
  assert.ok(a.steps.length >= 3);
  assert.match(a.steps.map((s) => s.text).join(" "), /Download PDF/);
});
test("the current page changes the instructions", () => {
  const elsewhere = stepsFor(getEntry("convert-word-to-pdf"), "/").steps;
  const here = stepsFor(getEntry("convert-word-to-pdf"), "/convert/word-to-pdf");
  assert.equal(here.onThisPage, true);
  assert.ok(here.steps.length < elsewhere.length, "on the converter the 'open the tool' step is dropped");
  assert.doesNotMatch(here.steps[0].text, /^Open the Word to PDF/);
  const editor = stepsFor(getEntry("insert-image"), "/tools/pdf-editor");
  assert.equal(editor.onThisPage, true);
  assert.doesNotMatch(editor.steps[0].text, /^Open the Add Image/);
  const a = buildGuideAnswer("how do I protect with a password", "/tools/protect-pdf");
  assert.match(a.intro, /already on/);
});
test("the page the visitor is on is recognised", () => {
  assert.equal(describePage("/tools/protect-pdf").label, "Protect PDF");
  assert.equal(describePage("/convert/word-to-pdf").area, "convert");
  assert.equal(describePage("/scan?x=1").area, "scan");
  assert.equal(describePage("/").area, "home");
});

console.log("Honesty about what is not supported");
test("unsupported things are explained, not instructed", () => {
  for (const [q, id] of [
    ["can I edit the existing text in my pdf", "limit-edit-existing-text"],
    ["how do I remove the password from a pdf", "limit-unlock"],
    ["how do I split a pdf", "limit-split"],
    ["how do I insert a picture in a word document and keep it as word", "limit-word-excel-output"],
  ]) {
    assert.equal(top(q), id, q);
  }
  assert.match(getEntry("limit-unlock").summary, /cannot/i);
  assert.match(getEntry("limit-edit-existing-text").summary, /^No\./);
  assert.match(getEntry("limit-word-excel-output").summary, /PDF/);
});
test("an unknown question says so instead of inventing an answer", () => {
  const a = buildGuideAnswer("how do I book a flight to Paris", "/");
  assert.equal(a.matched, false);
  assert.match(a.intro, /not sure/i);
  assert.equal(a.steps.length, 0);
  for (const l of a.links) assert.ok(isKnownRoute(l.href));
  assert.equal(buildGuideAnswer("", "/").matched, false);
});
test("nothing claims an action was performed", () => {
  const text = ENTRY_LIST.map((e) => entriesToPrompt([e], "/")).join("\n");
  assert.doesNotMatch(text, /\b(I have|I've|I will) (downloaded|submitted|deleted|sent|uploaded)/i);
  assert.doesNotMatch(text, /AI-powered|machine learning|premium plan/i);
});
test("signing is not described as a certified digital signature", () => {
  assert.match(getEntry("sign-pdf").notes.join(" "), /not a certificate-based digital signature/);
});

console.log("Input and output safety");
test("model answers cannot show invented pages, links or markup", () => {
  const out = sanitizeAnswer("Open /tools/protect-pdf now. Also try /tools/secret-vault and [click](https://evil.example/x) <b>here</b> https://evil.example/y or https://www.freepdfscanner.com/scan");
  assert.match(out, /\/tools\/protect-pdf/);
  assert.doesNotMatch(out, /secret-vault/);
  assert.doesNotMatch(out, /evil\.example/);
  assert.doesNotMatch(out, /<b>/);
  assert.match(out, /freepdfscanner\.com\/scan/);
  assert.ok(sanitizeAnswer("x".repeat(5000)).length < 1900);
});
test("contact details and long numbers are scrubbed before a question reaches the model", () => {
  const s = scrub("mail me at jo.bloggs@example.com or call +44 7700 900123, card 4111 1111 1111 1111");
  assert.doesNotMatch(s, /example\.com|7700|4111/);
});
test("requests are validated", () => {
  assert.equal(validateChatRequest(null).ok, false);
  assert.equal(validateChatRequest({ messages: [] }).ok, false);
  assert.equal(validateChatRequest({ messages: [{ role: "system", content: "x" }] }).ok, false);
  assert.equal(validateChatRequest({ messages: [{ role: "assistant", content: "x" }] }).ok, false);
  assert.equal(validateChatRequest({ messages: [{ role: "user", content: "a".repeat(501) }] }).ok, false);
  const good = validateChatRequest({ messages: [{ role: "user", content: "hi" }], path: "/tools/x?secret=1" });
  assert.equal(good.ok, true);
  assert.equal(good.value.path, "/tools/x");
  assert.equal(validateChatRequest({ messages: [{ role: "user", content: "hi" }], path: "https://evil" }).value.path, "/");
  const long = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "q" + i }));
  long.push({ role: "user", content: "last" });
  const trimmed = validateChatRequest({ messages: long });
  assert.equal(trimmed.ok, true);
  assert.ok(trimmed.value.messages.length <= 6);
  assert.equal(trimmed.value.messages[0].role, "user");
});

console.log("Create Word Document");
test("the page the assistant sends people to is real, and its controls and labels exist", () => {
  assert.ok(isKnownRoute("/create-word-document"));
  assert.ok(fs.existsSync(path.join(root, "app/create-word-document/page.tsx")));
  for (const id of ["create-word-document", "word-doc-formatting", "word-doc-font-size", "word-doc-margins", "word-doc-paragraph", "word-doc-add-page", "word-doc-phone-navigation", "word-doc-where-controls", "word-doc-pictures", "word-doc-save-download", "word-create-or-convert"]) {
    const e = getEntry(id);
    assert.ok(e, id);
    assert.equal(e.route, "/create-word-document", id);
  }
  // Every name it tells people to look for is on the screen.
  const ui = ["components/wordCreator/Toolbar.tsx", "components/wordCreator/WordCreator.tsx", "components/wordCreator/NavPad.tsx"].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  for (const label of ["Document name", "Insert image", "Add signature", "Save now", "New document", "My drafts", "Download Word (.docx)", "Text colour", "Highlight colour", "Line spacing", "Paragraph", "Page margins", "Add page", "Increase font size", "Decrease font size", "Choose font size from list", "Show navigation keys", "Move up one line", "Page up", "Page down", "Paragraph style", "Bulleted list", "Numbered list"]) assert.ok(ui.includes(label), label);
  const model = fs.readFileSync(path.join(root, "utils/wordCreator/model.ts"), "utf8");
  for (const label of ["Normal text", "Title", "Subtitle", "Heading 1", "Heading 2", "Heading 3", "Arial", "Times New Roman", "Calibri", "Georgia", "Verdana"]) assert.ok(model.includes(label), label);
  for (const label of ["% width", "Delete picture", "Description"]) assert.ok(ui.includes(label), label);
});
test("the questions people ask go to the right answer", () => {
  const home = (q) => rankEntries(q, "/", 1)[0]?.entry.id;
  assert.equal(home("How do I create a Word document from scratch?"), "create-word-document");
  assert.equal(home("Where can I find Create Word Document?"), "create-word-document");
  assert.equal(home("Create a Word document from scratch"), "create-word-document");
  assert.equal(home("How do I add a heading and body text?"), "word-doc-formatting");
  assert.equal(home("How can I change the font, size, colour, or spacing?"), "word-doc-formatting");
  assert.equal(home("How do I insert a picture into my Word document?"), "word-doc-pictures");
  assert.equal(home("how do I add my signature to a Word document"), "word-doc-pictures");
  assert.equal(home("How do I save my work and download it as a Word document?"), "word-doc-save-download");
  assert.equal(home("Will creating a Word document change my existing PDF?"), "word-create-or-convert");
  assert.equal(home("What's the difference between creating a Word document and converting a PDF to Word?"), "word-create-or-convert");
  // On the page itself, short questions mean that page's controls.
  const there = (q) => rankEntries(q, "/create-word-document", 1)[0]?.entry.id;
  assert.equal(there("How do I insert a picture?"), "word-doc-pictures");
  assert.equal(there("how do I add a heading"), "word-doc-formatting");
  assert.equal(there("how do I download it"), "word-doc-save-download");
});
test("the improved editor's questions go to the right answer", () => {
  const home = (q) => rankEntries(q, "/", 1)[0]?.entry.id;
  assert.equal(home("How do I change the font size without typing a number?"), "word-doc-font-size");
  assert.equal(home("How do I increase or decrease font size?"), "word-doc-font-size");
  assert.equal(home("How do I change the page margins?"), "word-doc-margins");
  assert.equal(home("How do I change paragraph alignment and line spacing?"), "word-doc-paragraph");
  assert.equal(home("How do I insert a new page before the current page is full?"), "word-doc-add-page");
  assert.equal(home("How do I navigate through my document on a phone?"), "word-doc-phone-navigation");
  assert.equal(home("How do I save and download my Word document?"), "word-doc-save-download");
  assert.equal(home("Where can I find page, paragraph and image controls?"), "word-doc-where-controls");
  assert.equal(home("How can I change the font, size, colour, or spacing?"), "word-doc-formatting");
  const there = (q) => rankEntries(q, "/create-word-document", 1)[0]?.entry.id;
  assert.equal(there("how do I make the text bigger"), "word-doc-font-size");
  assert.equal(there("margins"), "word-doc-margins");
  assert.equal(there("how do I double space"), "word-doc-paragraph");
  assert.equal(there("how do I add a page"), "word-doc-add-page");
  assert.equal(there("how do I move the cursor on my phone"), "word-doc-phone-navigation");
});
test("the improved editor's answers describe only what exists", () => {
  const ids = ["word-doc-font-size", "word-doc-margins", "word-doc-paragraph", "word-doc-add-page", "word-doc-phone-navigation", "word-doc-where-controls"];
  const text = entriesToPrompt(ids.map((i) => getEntry(i)), "/");
  // Real numbers: the list, the margin presets and limits, the font size range.
  for (const n of ["8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48 or 72", "Normal, Narrow, Moderate or Wide", "0.25 to 4", "1 to 400", "Ctrl+Enter", "Show navigation keys", "Phone view", "Page view"]) assert.ok(text.includes(n), n);
  // The list in the answer is the list in the product.
  const sizes = fs.readFileSync(path.join(root, "utils/wordCreator/model.ts"), "utf8").match(/FONT_SIZES = \[([^\]]+)\]/)[1].replace(/\s/g, "");
  assert.equal(sizes, "8,9,10,11,12,14,16,18,20,24,28,32,36,48,72");
  assert.doesNotMatch(text, /cloud|synced? across|real-time|collaborat|templates?|track changes|columns?|headers?.*add|footers?.*add/i);
  assert.doesNotMatch(text, /AI|voice|dictat|swipe to type|gesture/i);
  // Margins and page breaks reach the file.
  assert.match(text, /same margins are used in the downloaded .docx/);
  assert.match(text, /kept in the downloaded .docx/);
  // Phone answers do not pretend to be a keyboard.
  assert.match(getEntry("word-doc-phone-navigation").notes.join(" "), /With a physical keyboard/);
});
test("existing answers are unchanged by the new ones", () => {
  const home = (q) => rankEntries(q, "/", 1)[0]?.entry.id;
  assert.equal(home("how do i turn a pdf into word"), "convert-pdf-to-word");
  assert.equal(home("How do I convert a Word document to PDF?"), "convert-word-to-pdf");
  assert.equal(home("how do I extract text from a scanned page"), "ocr");
  assert.equal(home("how to sign a pdf"), "sign-pdf");
  assert.equal(home("How do I insert my passport photograph?"), "insert-image");
  assert.equal(rankEntries("How do I insert a picture?", "/scan", 1)[0]?.entry.id, "insert-image");
});
test("a question about making a document tells the three jobs apart and links to each", () => {
  const a = buildGuideAnswer("How do I create a Word document from scratch?", "/");
  assert.ok(a.matched);
  assert.equal(a.links[0].href, "/create-word-document");
  assert.ok(a.links.some((l) => l.href === "/convert/pdf-to-word"), "offers PDF to Word");
  assert.ok(a.links.some((l) => l.href === "/tools/ocr"), "offers OCR");
  const text = a.notes.join(" ");
  assert.match(text, /PDF to Word/);
  assert.match(text, /OCR/);
  assert.ok(!a.steps.some((s) => /upload/i.test(s.text)), "it never says a PDF must be uploaded to create a document");
  const here = stepsFor(getEntry("create-word-document"), "/create-word-document");
  assert.ok(here.onThisPage);
  assert.ok(!here.steps.some((s) => /Open Create Word Document/.test(s.text)), "already there, so it is not told to open it");
});
test("it describes only what the creator really does", () => {
  const ids = ["create-word-document", "word-doc-formatting", "word-doc-font-size", "word-doc-margins", "word-doc-paragraph", "word-doc-add-page", "word-doc-phone-navigation", "word-doc-where-controls", "word-doc-pictures", "word-doc-save-download", "word-create-or-convert"];
  const text = entriesToPrompt(ids.map((i) => getEntry(i)), "/");
  // Local drafts, not an account or the cloud.
  assert.match(text, /this browser/);
  assert.match(text, /not saved to an account/);
  assert.doesNotMatch(text, /cloud|synced? across|real-time|collaborat|spell.?check|\btemplates?\b|table of contents|track changes/i);
  assert.doesNotMatch(text, /\bAI\b/);
  // Tables, headers and footers are said to be missing, never offered.
  assert.match(text, /Tables, headers, footers and page numbers are not available yet/);
  assert.doesNotMatch(text, /insert (a )?table|add (a )?header/i);
  // Honest about signatures.
  assert.match(text, /not a certified digital signature/);
});
test("Create a Word document from scratch is offered as a suggestion and answers", () => {
  const s = suggestionsFor("/").find((x) => x.text === "Create a Word document from scratch");
  assert.ok(s);
  assert.equal(s.entryId, "create-word-document");
  assert.equal(buildGuideAnswer(s.text, "/").entryIds[0], "create-word-document");
});
test("the catalogue and other answers point to it", () => {
  assert.match(getEntry("all-tools").summary, /create a new Word document/);
  assert.match(getEntry("convert-pdf-to-word").notes.join(" "), /Create Word Document/);
  assert.match(getEntry("ocr").notes.join(" "), /Create Word Document/);
  assert.match(getEntry("limit-word-excel-output").summary, /Create Word Document/);
});

console.log("Signature and edit presets");
const SIGN_Q = "How do I add a signature to a PDF or document?";
const EDIT_Q = "How do I edit a PDF or document?";
test("the two preset questions are offered after the existing ones, on the home page and on other non-tool pages", () => {
  for (const p of ["/", "/tools", "/convert", "/history", "/privacy"]) {
    const asked = suggestionsFor(p).map((x) => x.text);
    assert.ok(asked.includes(SIGN_Q) && asked.includes(EDIT_Q), p);
  }
  const base = suggestionsFor("/").map((x) => x.text);
  assert.deepEqual(base.slice(0, 7), [
    "How do I convert a Word document to PDF?",
    "How do I insert my passport photograph?",
    "How do I combine multiple PDFs?",
    "How do I protect a PDF with a password?",
    "Where can I find my download?",
    "How do I use the scanner?",
    "Create a Word document from scratch",
  ]);
  assert.deepEqual(base.slice(7), [SIGN_Q, EDIT_Q]);
});
test("each preset leads to its own entry as the top answer", () => {
  assert.equal(suggestionsFor("/").find((x) => x.text === SIGN_Q).entryId, "add-signature");
  assert.equal(suggestionsFor("/").find((x) => x.text === EDIT_Q).entryId, "edit-document");
  assert.equal(buildGuideAnswer(SIGN_Q, "/").entryIds[0], "add-signature");
  assert.equal(buildGuideAnswer(EDIT_Q, "/").entryIds[0], "edit-document");
  assert.equal(buildGuideAnswer(SIGN_Q, "/").matched, true);
  assert.equal(buildGuideAnswer(EDIT_Q, "/").matched, true);
});
test("the new answers do not take over questions that already had a better answer", () => {
  assert.equal(top("how to sign a pdf"), "sign-pdf");
  assert.equal(top("how do i edit a pdf"), "edit-pdf");
  assert.equal(top("add signature to word document"), "word-doc-pictures");
  assert.equal(top("how do i sign this document?", "/tools/pdf-editor"), "sign-pdf");
});
test("the signature answer is step by step, links the real PDF and Word tools, and explains how they differ", () => {
  const a = buildGuideAnswer(SIGN_Q, "/");
  const hrefs = a.links.map((l) => l.href);
  assert.ok(hrefs.includes("/tools/sign-pdf") && hrefs.includes("/create-word-document"), hrefs.join(","));
  for (const l of a.links) assert.ok(isKnownRoute(l.href), l.href);
  assert.ok(a.steps.length >= 5);
  const text = a.steps.map((s) => s.text).concat(a.notes).join("\n");
  assert.match(text, /Edit page/);
  assert.match(text, /Create PDF and Download PDF/);
  assert.match(text, /Add signature/);
  assert.match(text, /Download Word \(\.docx\)/);
  assert.match(text, /does not open an existing file/);
  assert.match(text, /not a certificate-based digital signature/);
  assert.match(text, /you will get a PDF, not a Word file/);
});
test("the edit answer is honest about what editing means and links the real tools", () => {
  const a = buildGuideAnswer(EDIT_Q, "/");
  const hrefs = a.links.map((l) => l.href);
  for (const h of ["/tools/pdf-editor", "/convert/pdf-to-word", "/create-word-document"]) assert.ok(hrefs.includes(h), h);
  for (const l of a.links) assert.ok(isKnownRoute(l.href), l.href);
  const text = a.steps.map((s) => s.text).concat(a.notes).join("\n");
  assert.match(text, /cannot rewrite text that is already in a PDF/);
  assert.match(text, /does not open or change a file you already have/);
  assert.match(text, /Word \(\.docx\) file/);
  assert.doesNotMatch(text, /Open in Word/i);
});
test("the steps only mention controls that exist in the interface", () => {
  const ui = ["components/scanner/ScannerWorkspace.tsx", "components/scanner/PageEditor.tsx", "components/wordCreator/Toolbar.tsx", "components/wordCreator/WordCreator.tsx"]
    .filter((f) => fs.existsSync(path.join(root, f)))
    .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
    .join("\n");
  for (const label of ["Edit page", "Create PDF", "Download PDF", "Add signature", "Download Word (.docx)", "Move earlier", "Move later"]) assert.ok(ui.includes(label), label + " is not in the interface");
  const tools = fs.readFileSync(path.join(root, "utils/tools/registry.ts"), "utf8");
  for (const id of ["sign-pdf", "pdf-editor"]) assert.ok(tools.includes('"' + id + '"'), id);
});

console.log(`\n${pass} checks passed`);
