// Writes a document set in fonts that have no bundled twin, to
// tests/docx/fixtures/real/ (git-ignored), for comparing against Word's own PDF:
//   node tests/docx/make-real-font-fixture.mjs [Body Display Narrow SemiBold]
//   powershell -File tests/docx/word-export.ps1 -Dir tests/docx/fixtures/real
//   DOCX_FONT_FILES="C:/Windows/Fonts/verdana.ttf;..." node tests/docx/compare.mjs --dir real
// Defaults to Verdana / Georgia / Segoe UI / Segoe UI Semibold, which ship with
// Windows; pass Aptos, "Aptos Display", "Aptos Narrow", "Aptos SemiBold" on a
// machine that has them.

import fs from "node:fs";
import path from "node:path";
import { fixtures } from "./harness.mjs";
import { buildFontDoc } from "./font-helpers.mjs";

const [body = "Verdana", display = "Georgia", narrow = "Segoe UI", semibold = "Segoe UI Semibold"] = process.argv.slice(2);
const dir = path.join(fixtures, "real");
fs.mkdirSync(dir, { recursive: true });
const name = body.toLowerCase().replace(/\W+/g, "-");
fs.writeFileSync(path.join(dir, `font-${name}.docx`), await buildFontDoc({ body, display, narrow, semibold }, { semibold: true }));
console.log(`wrote fixtures/real/font-${name}.docx`);
