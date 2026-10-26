// Compares the editor's page layout with Microsoft Word's, for the same document: the editor is read from the real page,
// Word's from the PDF it exports of the downloaded .docx. Needs Word (COM) on this machine; it is a measurement tool, not
// part of the automatic suites.
//
//   npm run build && npx next start -p 3117      (another terminal)
//   node --no-warnings --import ./tests/scanner/register.mjs tests/wordCreator/layout-compare.mjs [--only id] [--reuse] [--width 390]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASE, CHROME, chromium } from "../audit/lib.mjs";
import { exportDocx } from "../../utils/wordCreator/docxExport.ts";
import { LAYOUT_DOCS } from "./layout-docs.mjs";
import { compareLayouts, lineKey, readEditorLayout, readWordLayout, seedDraft } from "./layout-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = value("--only");
const width = Number(value("--width") ?? 1280);
// --twin: behave like a device that has none of Calibri, Arial or Times New Roman installed (a phone): only the bundled twins are used
const twin = flag("--twin");
const twinCss = twin ? fs.readFileSync(path.join(here, "..", "..", "components", "wordCreator", "word-fonts.css"), "utf8").replace(/local\([^)]*\),\s*/g, "") : "";
const docs = LAYOUT_DOCS.filter((d) => !only || d.id.includes(only));

const ps1 = path.join(here, "word-pdf.ps1");
const word = (step, file = "", pdf = "") => {
  const extra = [...(file ? ["-File", file] : []), ...(pdf ? ["-Pdf", pdf] : [])];
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Step", step, ...extra], { encoding: "utf8", timeout: 120000 });
  if (r.status !== 0) throw new Error(`word ${step} ${path.basename(file)} failed: ${r.stderr || r.error || r.status}`);
  return r.stdout.trim();
};
// --record writes what Word did as the reference the automatic test (layout.mjs) compares the editor with
const record = flag("--record");
let wordVersion = "";
if (!flag("--reuse")) {
  wordVersion = word("start");
  console.log(wordVersion);
  for (const d of docs) {
    const docx = path.join(out, d.id + ".docx");
    const pdf = path.join(out, d.id + ".word.pdf");
    fs.rmSync(pdf, { force: true });
    fs.writeFileSync(docx, await exportDocx(d.doc, { title: d.id, margins: d.margins }));
    word("open", docx);
    const pages = word("export", docx, pdf);
    word("close", docx);
    console.log(`word: ${d.id} ${pages} pages`);
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let failed = 0;
for (const d of docs) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 700, hasTouch: width < 700 });
  const page = await context.newPage();
  await page.addInitScript(...seedDraft(d.doc, d.margins));
  await page.goto(BASE + "/create-word-document", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".wc-page");
  if (twin) await page.addStyleTag({ content: twinCss });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const editor = await readEditorLayout(page);
  const word = await readWordLayout(path.join(out, d.id + ".word.pdf"));
  const r = compareLayouts(editor, word);
  if (record) {
    const dir = path.join(here, "reference");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, d.id + ".json"), JSON.stringify({ id: d.id, word: wordVersion || "Microsoft Word", pages: word.pageCount, lines: word.lines.map((l) => [l.page, lineKey(l.text)]) }) + "\n");
  }
  const ok = r.sameLines === r.wordLines && r.editorLines === r.wordLines;
  if (!ok) failed++;
  console.log(`${ok ? "SAME " : "DIFF "} ${d.id.padEnd(18)} lines ${r.sameLines}/${r.wordLines} (editor ${r.editorLines}), pages editor ${r.editorPages} / word ${r.wordPages}, max vertical drift ${Number.isNaN(r.maxDrift) ? "n/a (mixed sizes)" : r.maxDrift.toFixed(2) + "pt"}  [${d.note}]`);
  for (const x of r.diffs) console.log(`        #${x.index}  editor: ${x.editor}\n              word:   ${x.word}`);
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
