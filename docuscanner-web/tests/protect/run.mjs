// Tests for Protect PDF and Protect Word document. Runs the real code (not mocks) in Node:
// the QPDF WebAssembly engine, Web Crypto and the same modules the browser loads.
//
// Independent checks: PDFs are opened with pdf.js; Word files are decrypted with
// msoffcrypto-tool (Python, the reference open-source Office decryptor) and LibreOffice when
// they are installed. Microsoft Word itself is NOT available here: see tests/protect/README.md.
//
// Run: node tests/protect/run.mjs        (LARGE=1 also runs a ~48 MB document)

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as CFB from "cfb";
import JSZip from "jszip";
import { makeLargeDocx, makePdf, makeTestDocx, PASSWORD, retypeDocx } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "protect-"));
process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));

const { protectPdf, encryptArgs, validatePassword, protectedFilename, ProtectError, MIN_PASSWORD_LENGTH } = await import("../../utils/protect/protect.ts");
const { encryptDocx, verifyEncryptedDocx, dataSpaceStructures, looksLikeOfficeEncrypted } = await import("../../utils/protect/ooxml.ts");
const { validateDocxPackage } = await import("../../utils/protect/docx.ts");
const { runProtection, toProtectError } = await import("../../utils/protect/operation.ts");
const { protectErrorMessage } = await import("../../utils/protect/messages.ts");
const { writeCfb } = await import("../../utils/protect/cfbWriter.ts");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const createModule = require("@neslinesli93/qpdf-wasm");

const wasm = path.join(root, "node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm");
const createQpdf = async () => createModule({ locateFile: () => wasm, noInitialRun: true });
const engines = { createQpdf };
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const req = (kind, bytes, over = {}) => ({ kind, bytes, password: PASSWORD, options: { allowPrint: true, allowCopy: true, allowEdit: false }, ...over });
async function code(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ProtectError, `expected a ProtectError, got ${error?.name}: ${error?.message}`);
    return error.code;
  }
  return "no-error";
}

let failed = 0;
async function test(name, fn) {
  const t = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Date.now() - t} ms)`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n     ${error.stack?.split("\n").slice(0, 4).join("\n     ")}`);
  }
}

const hasPython = spawnSync("python3", ["-c", "import msoffcrypto"]).status === 0;
function msoffcryptoDecrypt(file, password) {
  const script = `
import msoffcrypto, sys, io
f = open(sys.argv[1], "rb"); o = msoffcrypto.OfficeFile(f)
print("ENCRYPTED" if o.is_encrypted() else "PLAIN")
o.load_key(password=sys.argv[2]); out = io.BytesIO(); o.decrypt(out)
sys.stdout.buffer.write(out.getvalue())`;
  const r = spawnSync("python3", ["-c", script, file, password], { maxBuffer: 512 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: String(r.stderr) };
}

// ================================ Protect PDF ================================

const pdf = await makePdf();

await test("PDF: protected output opens only with the password (pdf.js as an independent reader)", async () => {
  const { data } = await protectPdf(pdf, { password: PASSWORD, allowPrint: true, allowCopy: true, allowEdit: false }, createQpdf);
  assert.notDeepEqual(Buffer.from(data), Buffer.from(pdf));
  const open = (password) => pdfjs.getDocument({ data: new Uint8Array(data), password, useSystemFonts: true, verbosity: 0 }).promise;
  await assert.rejects(open(undefined), (e) => e.name === "PasswordException" && e.code === 1);
  await assert.rejects(open("wrong password"), (e) => e.name === "PasswordException" && e.code === 2);
  const doc = await open(PASSWORD);
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join("");
  assert.match(text, /Hello protected world/);
});

await test("PDF: AES-256 (revision 6) is written, permissions match the choices", async () => {
  const { data } = await protectPdf(pdf, { password: PASSWORD, allowPrint: false, allowCopy: false, allowEdit: false }, createQpdf);
  const q = await createQpdf();
  q.FS.writeFile("/o.pdf", data);
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => (chunks.push(String(c)), true);
  try {
    q.callMain(["--show-encryption", `--password=${PASSWORD}`, "/o.pdf"]);
  } finally {
    process.stdout.write = original;
  }
  const report = chunks.join("");
  assert.match(report, /R = 6/);
  assert.match(report, /stream encryption method: AESv3/);
  assert.match(report, /print high resolution: not allowed/);
  assert.match(report, /extract for any purpose: not allowed/);
  assert.match(report, /modify anything: not allowed/);
  const args = encryptArgs({ password: "x", allowPrint: true, allowCopy: true, allowEdit: true }, "o");
  assert.ok(args.includes("--print=full") && args.includes("--extract=y") && args.includes("--modify=all"));
});

await test("PDF: password rules (missing, short, long, mismatch)", async () => {
  assert.equal(validatePassword(""), "protect_password_missing");
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1)), "protect_password_short");
  assert.equal(validatePassword("é".repeat(70)), "protect_password_long");
  assert.equal(validatePassword("secret1", "secret2"), "protect_password_mismatch");
  assert.equal(validatePassword("p@ss w0rd/\\'\"<>&%$#! ẹ ọ ₦", "p@ss w0rd/\\'\"<>&%$#! ẹ ọ ₦"), "");
  assert.equal(await code(protectPdf(pdf, { password: "", allowPrint: true, allowCopy: true, allowEdit: false }, createQpdf)), "protect_password_missing");
});

await test("PDF: corrupt, empty and already-protected files are refused with no output", async () => {
  const opts = { password: PASSWORD, allowPrint: true, allowCopy: true, allowEdit: false };
  assert.equal(await code(protectPdf(new Uint8Array(0), opts, createQpdf)), "protect_invalid");
  assert.equal(await code(protectPdf(new TextEncoder().encode("not a pdf"), opts, createQpdf)), "protect_invalid");
  assert.equal(await code(protectPdf(new TextEncoder().encode("%PDF-1.4\ngarbage"), opts, createQpdf)), "protect_invalid");
  const { data } = await protectPdf(pdf, opts, createQpdf);
  assert.equal(await code(protectPdf(data, opts, createQpdf)), "protect_already_protected");
});

await test("PDF: symbols/Unicode passwords round-trip", async () => {
  for (const password of ["p@ss w0rd/\\'\"<>&%$#!", "Ọlájídé-2024", "a".repeat(127)]) {
    const { data } = await protectPdf(pdf, { password, allowPrint: true, allowCopy: true, allowEdit: false }, createQpdf);
    await pdfjs.getDocument({ data: new Uint8Array(data), password, verbosity: 0 }).promise;
  }
});

await test("PDF: output name", () => assert.equal(protectedFilename("Q3 report.pdf"), "Q3 report-protected.pdf"));

// ================================ Protect Word: encryption ================================

const docx = await makeTestDocx();
const docxHash = sha(docx);
let encrypted;

await test("DOCX: fixture is a real .docx with the content we care about", async () => {
  const zip = await JSZip.loadAsync(docx);
  const body = await zip.file("word/document.xml").async("string");
  for (const needle of ["Test document", "A hyperlink", "Ọlájídé", "₦5,000.00", "w:tbl", "w:drawing", "w:br w:type=\"page\"", "w:sectPr"]) assert.ok(body.includes(needle), needle);
  assert.ok(Object.keys(zip.files).some((f) => f.startsWith("word/media/")));
  assert.ok(Object.keys(zip.files).some((f) => f.startsWith("word/header")) && Object.keys(zip.files).some((f) => f.startsWith("word/footer")));
});

await test("DOCX: encrypt produces a genuine Office-encrypted container, not the .docx and not a ZIP", async () => {
  ({ data: encrypted } = await encryptDocx(docx, PASSWORD));
  assert.ok(looksLikeOfficeEncrypted(encrypted), "OLE/CFB signature");
  assert.notEqual(String.fromCharCode(encrypted[0], encrypted[1]), "PK", "must not be a ZIP");
  assert.notDeepEqual(Buffer.from(encrypted), Buffer.from(docx));
  await assert.rejects(JSZip.loadAsync(encrypted), "an ordinary docx/zip reader must not open it");
  assert.ok(!Buffer.from(encrypted).includes(Buffer.from("word/document.xml")), "no plaintext package entry names");
  assert.ok(!Buffer.from(encrypted).includes(Buffer.from("Ọlájídé")), "no plaintext content");
  const cfb = CFB.read(encrypted, { type: "array" });
  const names = cfb.FullPaths.map((p) => p.replace("Root Entry/", ""));
  for (const n of ["EncryptionInfo", "EncryptedPackage", "\u0006DataSpaces/Version", "\u0006DataSpaces/DataSpaceMap", "\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace", "\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary"]) {
    assert.ok(names.includes(n), `missing ${JSON.stringify(n)}`);
  }
  assert.ok(!names.some((n) => /Sh33tJ5/.test(n)), "no library placeholder streams");
});

await test("DOCX: EncryptionInfo is Agile 4.4 with AES-256 / SHA-512 / 100000 rounds / integrity data", () => {
  const cfb = CFB.read(encrypted, { type: "array" });
  const info = Buffer.from(CFB.find(cfb, "/EncryptionInfo").content);
  assert.deepEqual([...info.subarray(0, 8)], [4, 0, 4, 0, 0x40, 0, 0, 0]);
  const xml = info.subarray(8).toString("utf8");
  for (const s of ['xmlns="http://schemas.microsoft.com/office/2006/encryption"', 'keyBits="256"', 'cipherAlgorithm="AES"', 'cipherChaining="ChainingModeCBC"', 'hashAlgorithm="SHA512"', 'spinCount="100000"', 'saltSize="16"', "encryptedHmacKey=", "encryptedHmacValue=", "encryptedVerifierHashInput=", "encryptedVerifierHashValue=", "encryptedKeyValue=", "keyEncryptor/password"]) {
    assert.ok(xml.includes(s), s);
  }
  const size = Buffer.from(CFB.find(cfb, "/EncryptedPackage").content).readBigUInt64LE(0);
  assert.equal(Number(size), docx.length, "the stream records the original package size");
});

await test("DOCX: the four DataSpaces streams match the reference bytes byte-for-byte", () => {
  const ref = {
    version: "3c0000004d006900630072006f0073006f00660074002e0043006f006e007400610069006e00650072002e004400610074006100530070006100630065007300010000000100000001000000",
    map: "08000000010000006800000001000000000000002000000045006e0063007200790070007400650064005000610063006b00610067006500320000005300740072006f006e00670045006e006300720079007000740069006f006e004400610074006100530070006100630065000000",
    strongEncryptionDataSpace: "0800000001000000320000005300740072006f006e00670045006e006300720079007000740069006f006e005400720061006e00730066006f0072006d000000",
    primary: "58000000010000004c0000007b00460046003900410033004600300033002d0035003600450046002d0034003600310033002d0042004400440035002d003500410034003100430031004400300037003200340036007d004e0000004d006900630072006f0073006f00660074002e0043006f006e007400610069006e00650072002e0045006e006300720079007000740069006f006e005400720061006e00730066006f0072006d00000001000000010000000100000000000000000000000000000004000000",
  };
  for (const [key, hex] of Object.entries(ref)) assert.equal(Buffer.from(dataSpaceStructures[key]()).toString("hex"), hex, key);
});

await test("DOCX: our own verifier accepts the right password and rejects wrong / empty / tampered input", async () => {
  await verifyEncryptedDocx(encrypted, docx, PASSWORD);
  assert.equal(await code(verifyEncryptedDocx(encrypted, docx, "wrong password")), "protect_unverified");
  assert.equal(await code(verifyEncryptedDocx(encrypted, docx, "")), "protect_unverified");
  assert.equal(await code(verifyEncryptedDocx(docx, docx, PASSWORD)), "protect_unverified", "a plain .docx is never accepted as output");
  const other = new Uint8Array(docx);
  other[100] ^= 1;
  assert.equal(await code(verifyEncryptedDocx(encrypted, other, PASSWORD)), "protect_unverified", "decrypts to something other than the original");
  // Flip one byte inside the encrypted package: the HMAC must catch it.
  const cfb = CFB.read(encrypted, { type: "array" });
  const stream = Uint8Array.from(CFB.find(cfb, "/EncryptedPackage").content);
  stream[stream.length - 20] ^= 1;
  const info = Uint8Array.from(CFB.find(cfb, "/EncryptionInfo").content);
  const tampered = writeCfb({
    name: "Root Entry",
    children: [
      { name: "\u0006DataSpaces", children: [{ name: "Version", data: dataSpaceStructures.version() }, { name: "DataSpaceMap", data: dataSpaceStructures.map() }, { name: "DataSpaceInfo", children: [{ name: "StrongEncryptionDataSpace", data: dataSpaceStructures.strongEncryptionDataSpace() }] }, { name: "TransformInfo", children: [{ name: "StrongEncryptionTransform", children: [{ name: "\u0006Primary", data: dataSpaceStructures.primary() }] }] }] },
      { name: "EncryptionInfo", data: info },
      { name: "EncryptedPackage", data: stream },
    ],
  });
  assert.equal(await code(verifyEncryptedDocx(tampered, docx, PASSWORD)), "protect_unverified");
});

await test("DOCX: every run uses fresh randomness (two encryptions of the same file differ)", async () => {
  const { data: again } = await encryptDocx(docx, PASSWORD);
  assert.notDeepEqual(Buffer.from(again), Buffer.from(encrypted));
});

await test("DOCX: Unicode, long, and symbol passwords work", async () => {
  for (const password of ["Ọlájídé Adéọlá 🔐 ₦", "x".repeat(255), "p@ss w0rd/\\'\"<>&%$#!"]) {
    const { data } = await encryptDocx(docx, password);
    await verifyEncryptedDocx(data, docx, password);
    assert.equal(await code(verifyEncryptedDocx(data, docx, password + "x")), "protect_unverified");
  }
});

await test("DOCX: the original bytes are never modified", () => assert.equal(sha(docx), docxHash));

// ================================ Independent decryptors ================================

if (hasPython) {
  await test("DOCX: msoffcrypto-tool (independent reference) decrypts to the identical original package", () => {
    const file = path.join(work, "protected.docx");
    fs.writeFileSync(file, encrypted);
    const r = msoffcryptoDecrypt(file, PASSWORD);
    assert.equal(r.status, 0, r.stderr);
    const nl = r.stdout.indexOf(10);
    assert.equal(r.stdout.subarray(0, nl).toString(), "ENCRYPTED");
    assert.equal(sha(r.stdout.subarray(nl + 1)), docxHash, "decrypted package must equal the original byte-for-byte");
  });
  await test("DOCX: msoffcrypto-tool rejects a wrong password", () => {
    const file = path.join(work, "protected.docx");
    assert.notEqual(msoffcryptoDecrypt(file, "not the password").status, 0);
  });
  await test("DOCX: a decrypted package is a valid .docx with all the content", async () => {
    const r = msoffcryptoDecrypt(path.join(work, "protected.docx"), PASSWORD);
    const zip = await JSZip.loadAsync(r.stdout.subarray(r.stdout.indexOf(10) + 1));
    assert.ok((await zip.file("word/document.xml").async("string")).includes("Ọlájídé"));
  });
} else console.log("skip msoffcrypto-tool checks (pip install msoffcrypto-tool)");

const soffice = spawnSync("which", ["soffice"]).status === 0 && spawnSync("python3", ["-c", "import uno"]).status === 0 && fs.existsSync("/usr/lib/libreoffice/program/libswlo.so");
if (soffice) {
  const lo = (file, pw) => spawnSync("python3", [path.join(here, "lo_open.py"), file, ...(pw === undefined ? [] : [pw])], { encoding: "utf8", timeout: 180000 }).stdout;
  await test("DOCX: LibreOffice (independent Office-crypto implementation) opens it with the password, refuses wrong/none", () => {
    const file = path.join(work, "protected.docx");
    assert.match(lo(file, PASSWORD), /OPENED: Test document/);
    assert.match(lo(file, "wrong"), /OPEN_FAILED/);
    assert.match(lo(file), /OPEN_FAILED/);
  });
} else console.log("skip LibreOffice checks (needs libreoffice-writer + python3-uno)");

// ================================ Input validation ================================

await test("DOCX: input validation accepts .docx; rejects corrupt, empty, .docm, templates, legacy and already-encrypted", async () => {
  await validateDocxPackage(docx);
  assert.equal(await code(validateDocxPackage(new Uint8Array(0))), "protect_invalid");
  assert.equal(await code(validateDocxPackage(new TextEncoder().encode("hello"))), "protect_invalid");
  assert.equal(await code(validateDocxPackage(docx.subarray(0, Math.floor(docx.length / 2)))), "protect_invalid", "truncated zip");
  const noDoc = new JSZip();
  noDoc.file("[Content_Types].xml", "<Types/>");
  assert.equal(await code(validateDocxPackage(new Uint8Array(await noDoc.generateAsync({ type: "uint8array" })))), "protect_invalid");
  const docm = await retypeDocx(docx, (ct) => ct.replace("wordprocessingml.document.main+xml", "wordprocessingml.document.macroEnabled.main+xml"));
  assert.equal(await code(validateDocxPackage(docm)), "protect_macro_unsupported");
  const dotx = await retypeDocx(docx, (ct) => ct.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml"));
  assert.equal(await code(validateDocxPackage(dotx)), "protect_unsupported_type");
  const withVba = await JSZip.loadAsync(docx);
  withVba.file("word/vbaProject.bin", new Uint8Array([1, 2, 3]));
  assert.equal(await code(validateDocxPackage(new Uint8Array(await withVba.generateAsync({ type: "uint8array" })))), "protect_macro_unsupported");
  assert.equal(await code(validateDocxPackage(encrypted)), "protect_already_protected");
  const legacy = writeCfb({ name: "Root Entry", children: [{ name: "WordDocument", data: new Uint8Array(5000) }] });
  assert.equal(await code(validateDocxPackage(legacy)), "protect_unsupported_type");
  assert.equal(await code(validateDocxPackage(new Uint8Array(51 * 1024 * 1024))), "protect_too_large");
});

// ================================ The transaction ================================

await test("operation: valid DOCX + password -> protected .docx, phases in order, original untouched", async () => {
  const phases = [];
  const out = await runProtection(req("docx", docx), engines, { onPhase: (p) => phases.push(p) });
  assert.deepEqual(phases, ["validating", "encrypting", "verifying", "completed"]);
  assert.equal(out.extension, "docx");
  assert.ok(looksLikeOfficeEncrypted(out.data));
  assert.equal(sha(docx), docxHash);
});

await test("operation: valid PDF + password -> protected PDF", async () => {
  const out = await runProtection(req("pdf", pdf), engines);
  assert.equal(out.extension, "pdf");
  await pdfjs.getDocument({ data: new Uint8Array(out.data), password: PASSWORD, verbosity: 0 }).promise;
});

await test("operation: missing / short password fails validation before any encryption", async () => {
  let encryptCalled = false;
  const spy = { ...engines, encryptDocx: async (...a) => ((encryptCalled = true), encryptDocx(...a)) };
  assert.equal(await code(runProtection(req("docx", docx, { password: "" }), spy)), "protect_password_missing");
  assert.equal(await code(runProtection(req("docx", docx, { password: "abc" }), spy)), "protect_password_short");
  assert.equal(encryptCalled, false);
});

await test("operation: corrupt DOCX -> no output, original preserved", async () => {
  const corrupt = docx.slice(0, 3000);
  const before = sha(corrupt);
  assert.equal(await code(runProtection(req("docx", corrupt), engines)), "protect_invalid");
  assert.equal(sha(corrupt), before);
});

await test("operation: an encryption exception -> generic failure, no output, retry works", async () => {
  const boom = { ...engines, encryptDocx: async () => { throw new Error("secret internal detail with TestPassword123!"); } };
  const error = await runProtection(req("docx", docx), boom).catch((e) => e);
  assert.equal(error.code, "protect_failed");
  assert.ok(!error.message.includes("secret") && !error.message.includes(PASSWORD), "raw exception text never surfaces");
  const retry = await runProtection(req("docx", docx), engines);
  assert.ok(looksLikeOfficeEncrypted(retry.data));
});

await test("operation: output that fails verification is discarded", async () => {
  const bad = { ...engines, encryptDocx: async () => ({ data: docx }) }; // "encrypts" to the plain .docx
  assert.equal(await code(runProtection(req("docx", docx), bad)), "protect_unverified");
  const garbage = { ...engines, encryptDocx: async () => ({ data: new Uint8Array(100) }) };
  assert.equal(await code(runProtection(req("docx", docx), garbage)), "protect_unverified");
});

await test("operation: memory failure -> protect_memory with the friendly message", async () => {
  const oom = { ...engines, encryptDocx: async () => { throw new RangeError("Array buffer allocation failed"); } };
  assert.equal(await code(runProtection(req("docx", docx), oom)), "protect_memory");
  assert.match(protectErrorMessage("protect_memory"), /too large for your browser/);
});

await test("operation: cancelling mid-encryption -> protect_cancelled, no output", async () => {
  const controller = new AbortController();
  const promise = runProtection(req("docx", docx), engines, { signal: controller.signal, onPhase: (p) => p === "encrypting" && setTimeout(() => controller.abort(), 200) });
  assert.equal(await code(promise), "protect_cancelled");
  assert.equal(protectErrorMessage("protect_cancelled"), "Protection cancelled. Your original document is unchanged.");
  const already = new AbortController();
  already.abort();
  assert.equal(await code(runProtection(req("docx", docx), engines, { signal: already.signal })), "protect_cancelled");
});

await test("operation: a hung step times out instead of leaving the UI stuck", async () => {
  const hang = { ...engines, encryptDocx: () => new Promise(() => {}) }; // never settles, ignores the signal
  const t = Date.now();
  assert.equal(await code(runProtection(req("docx", docx), hang, { timeoutMs: 300 })), "protect_timeout");
  assert.ok(Date.now() - t < 3000);
});

await test("operation: retry after a failure starts fresh; a later failure never returns an earlier result", async () => {
  const ok1 = await runProtection(req("docx", docx), engines);
  const failure = await code(runProtection(req("docx", docx), { ...engines, encryptDocx: async () => { throw new Error("x"); } }));
  assert.equal(failure, "protect_failed");
  const ok2 = await runProtection(req("docx", docx), engines);
  assert.notDeepEqual(Buffer.from(ok1.data), Buffer.from(ok2.data));
});

await test("operation: two simultaneous operations do not cross-contaminate", async () => {
  const docB = await makeTestDocx({ imageSize: 60 });
  const [a, b] = await Promise.all([runProtection(req("docx", docx, { password: "password-for-A" }), engines), runProtection(req("docx", docB, { password: "password-for-B" }), engines)]);
  await verifyEncryptedDocx(a.data, docx, "password-for-A");
  await verifyEncryptedDocx(b.data, docB, "password-for-B");
  assert.equal(await code(verifyEncryptedDocx(a.data, docB, "password-for-B")), "protect_unverified");
});

await test("operation: unexpected errors map to generic codes", () => {
  assert.equal(toProtectError(new Error("anything")).code, "protect_failed");
  assert.equal(toProtectError("string").code, "protect_failed");
  assert.equal(toProtectError(new RangeError("x")).code, "protect_memory");
});

// ================================ Sizes and performance ================================

async function sizeTest(label, megabytes) {
  await test(`DOCX: ${label} protects, verifies and decrypts identically`, async () => {
    const big = megabytes ? await makeLargeDocx(megabytes) : docx;
    const rssBefore = process.memoryUsage().rss;
    const t = Date.now();
    const out = await runProtection(req("docx", big), engines);
    const ms = Date.now() - t;
    console.log(`     ${(big.length / 1048576).toFixed(1)} MB in -> ${(out.data.length / 1048576).toFixed(1)} MB out, ${ms} ms total (encrypt + verify), rss +${Math.round((process.memoryUsage().rss - rssBefore) / 1048576)} MB`);
    if (hasPython) {
      const file = path.join(work, `big-${megabytes}.docx`);
      fs.writeFileSync(file, out.data);
      const r = msoffcryptoDecrypt(file, PASSWORD);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(sha(r.stdout.subarray(r.stdout.indexOf(10) + 1)), sha(big));
      fs.rmSync(file);
    }
  });
}
await sizeTest("a 10 MB document", 10);
if (process.env.LARGE) await sizeTest("a 48 MB document (near the 50 MB limit)", 48);

// ================================ Policy checks on the source ================================

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const protectSources = ["utils/protect/protect.ts", "utils/protect/ooxml.ts", "utils/protect/cfbWriter.ts", "utils/protect/docx.ts", "utils/protect/operation.ts", "utils/protect/browser.ts", "components/tools/ProtectTool.tsx"];

await test("policy: nothing in the protect code talks to a server, logs, or stores a password", () => {
  for (const f of protectSources) {
    const src = read(f).replace(/\/\/.*$/gm, "");
    assert.ok(!/\bfetch\(/.test(src) || f.endsWith("browser.ts"), `${f} calls fetch`);
    assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(src), `${f} opens a connection`);
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(src), `${f} logs`);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|history\.(push|replace)State/.test(src), `${f} stores data`);
    assert.ok(!/Math\.random/.test(src), `${f} uses Math.random`);
  }
  // The only fetches in browser.ts: the same-origin engine file and the local data: URL of a picture.
  const fetches = read("utils/protect/browser.ts").match(/fetch\([^)]*\)/g) ?? [];
  assert.deepEqual(fetches, ["fetch(captured.dataUrl)"]);
  assert.match(read("utils/protect/browser.ts"), /QPDF_WASM_URL = "\/qpdf\/qpdf\.wasm"/);
  assert.ok(/crypto\.getRandomValues/.test(read("utils/protect/ooxml.ts")) && /crypto\.getRandomValues/.test(read("utils/protect/protect.ts")));
});

await test("policy: analytics calls carry only kind, timing, permission ticks and error codes", () => {
  const events = read("utils/analytics/events.ts");
  const block = events.slice(events.indexOf("export function trackProtectStarted"), events.indexOf("// signature_drawn"));
  assert.ok(!/password|filename|file\.name|bytes/i.test(block.replace(/never the file, its name, or any password/i, "")), block);
  const tool = read("components/tools/ProtectTool.tsx");
  for (const call of tool.match(/track\w+\([^;]*\);/g) ?? []) assert.ok(!/password|confirm|file\b|filename/i.test(call.replace("trackProtectFailed(code)", "")), call);
});

await test("policy: Protect is public: no auth requirement, no server route, no API, no upload", () => {
  const registry = read("utils/tools/registry.ts");
  assert.match(registry, /kind: "protect",\n\s+feature,\n\s+focus,\n\s+\/\/ Locking happens on the visitor's device, so it never needs a login.\n\s+requiresAuth: false/);
  assert.ok(!fs.existsSync(path.join(root, "app/api/protect")), "no protect API route");
  const tool = read("components/tools/ProtectTool.tsx");
  assert.ok(!/useAuth\(\)[\s\S]{0,80}(!user|user ===|user\?)/.test(tool.replace(/getUserPlan\(user\)/, "")), "the tool never branches on being signed in");
  assert.ok(!/supabase|createClient|\/api\//.test(tool + read("utils/protect/browser.ts") + read("utils/protect/operation.ts")));
});

await test("policy: the Word option is a feature flag that defaults OFF and removes the Word page when off", () => {
  const probe = (env) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const {TOOLS}=await import("./utils/tools/registry.ts");const {FEATURES}=await import("./utils/features/plans.ts");console.log(JSON.stringify({word:TOOLS.some(t=>t.slug==="protect-word"),pdf:TOOLS.some(t=>t.slug==="protect-pdf"),flag:FEATURES["protect.docx"].implemented}))`], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
    return JSON.parse(r.stdout.trim().split("\n").pop());
  };
  assert.deepEqual(probe({ NEXT_PUBLIC_DOCX_PROTECTION_ENABLED: "" }), { word: false, pdf: true, flag: false });
  assert.deepEqual(probe({ NEXT_PUBLIC_DOCX_PROTECTION_ENABLED: "true" }), { word: true, pdf: true, flag: true });
});

console.log(failed ? `\n${failed} test(s) FAILED` : "\nAll protect tests passed");
process.exit(failed ? 1 : 0);
