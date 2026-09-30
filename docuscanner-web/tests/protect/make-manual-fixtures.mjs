// Writes the files used for the manual phone/Word validation (tests/protect/MANUAL-VALIDATION.md)
// to tests/protect/out/manual/ (git-ignored), with their SHA-256 sums:
//   small.docx   rich document (headings, table, picture, link, lists, header/footer, 2 sections, Unicode names)
//   10mb.docx    about 10 MB
//   48mb.docx    about 48 MB (near the 50 MB limit)
//   node tests/protect/make-manual-fixtures.mjs [--skip-large]

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeLargeDocx, makeTestDocx } from "./fixtures.mjs";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "manual");
fs.mkdirSync(out, { recursive: true });
const sums = [];
for (const [name, build] of [
  ["small.docx", () => makeTestDocx()],
  ["10mb.docx", () => makeLargeDocx(9.8)],
  ...(process.argv.includes("--skip-large") ? [] : [["48mb.docx", () => makeLargeDocx(47.4)]]),
]) {
  const bytes = await build();
  fs.writeFileSync(path.join(out, name), bytes);
  sums.push(`${crypto.createHash("sha256").update(bytes).digest("hex")}  ${name}  (${bytes.length} bytes, ${(bytes.length / 1048576).toFixed(2)} MB)`);
}
fs.writeFileSync(path.join(out, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(sums.join("\n"));
