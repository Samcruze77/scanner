// Checks a protected .docx that came from the LIVE Protect Word page against the original
// file it was made from, using the same independent verification the page runs (full
// decryption, password check, HMAC, byte-for-byte comparison), plus a wrong-password check.
// It proves the file is a correct Office-encrypted copy of THAT original. It does not replace
// opening it in Microsoft Word.
//
//   node tests/protect/check-download.mjs original.docx protected.docx "the password"

import crypto from "node:crypto";
import fs from "node:fs";

const [, , originalPath, protectedPath, password] = process.argv;
if (!originalPath || !protectedPath || password === undefined) {
  console.error('usage: node tests/protect/check-download.mjs original.docx protected.docx "password"');
  process.exit(2);
}
const { verifyEncryptedDocx, looksLikeOfficeEncrypted } = await import("../../utils/protect/ooxml.ts");
const original = new Uint8Array(fs.readFileSync(originalPath));
const protectedFile = new Uint8Array(fs.readFileSync(protectedPath));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const row = (label, value) => console.log(`${label.padEnd(34)} ${value}`);

row("original size", `${original.length} bytes (${(original.length / 1048576).toFixed(2)} MB)`);
row("original sha256", sha(original));
row("protected size", `${protectedFile.length} bytes (${(protectedFile.length / 1048576).toFixed(2)} MB)`);
row("protected is an OLE container", looksLikeOfficeEncrypted(protectedFile) ? "yes" : "NO");
row("protected starts with PK (zip)", protectedFile[0] === 0x50 && protectedFile[1] === 0x4b ? "YES (plain docx, not protected!)" : "no");
row("password length", `${Array.from(password).length} characters, ${new TextEncoder().encode(password).length} UTF-8 bytes, ${password.length} UTF-16 units`);
let ok = true;
const attempt = async (label, pw, expectOk) => {
  const t = Date.now();
  let passed = false;
  try {
    await verifyEncryptedDocx(protectedFile, original, pw);
    passed = true;
  } catch {}
  const good = passed === expectOk;
  ok &&= good;
  row(label, `${passed ? "decrypts and equals the original" : "rejected"}  ${good ? "OK" : "UNEXPECTED"} (${Date.now() - t} ms)`);
};
await attempt("correct password", password, true);
await attempt("wrong password", password + "x", false);
await attempt("empty password", "", false);
console.log(ok ? "\nRESULT: the file is a correct Office-encrypted copy of the original." : "\nRESULT: PROBLEM: see UNEXPECTED above.");
process.exit(ok ? 0 : 1);
