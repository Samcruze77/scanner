// Writes a protected sample so a person can open it in REAL Microsoft Word (the one check
// that cannot be automated here). Output goes to tests/protect/out/ (git-ignored).
//   node tests/protect/make-sample.mjs      password: TestPassword123!

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestDocx, PASSWORD } from "./fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const { encryptDocx, verifyEncryptedDocx } = await import("../../utils/protect/ooxml.ts");
const original = await makeTestDocx();
const { data } = await encryptDocx(original, PASSWORD);
await verifyEncryptedDocx(data, original, PASSWORD);
fs.writeFileSync(path.join(out, "sample-original.docx"), original);
fs.writeFileSync(path.join(out, "sample-protected.docx"), data);
console.log(`Wrote ${path.join(out, "sample-protected.docx")}\nPassword: ${PASSWORD}`);
