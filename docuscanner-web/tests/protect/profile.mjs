// Memory and timing profile of Protect Word in a CLEAN process per size (the fixture is built
// beforehand and read from disk, so its own memory is not counted).
//   node tests/protect/profile.mjs [sizeMB ...]        default: 1 10 25 48
// Each child samples process memory every 10 ms while the operation runs and reports the peaks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const role = process.argv[2];

if (role === "child") {
  const [, , , file, password] = process.argv;
  const { runProtection } = await import("../../utils/protect/operation.ts");
  const bytes = new Uint8Array(fs.readFileSync(file)); // the File -> ArrayBuffer step
  const base = process.memoryUsage();
  const peak = { rss: 0, heap: 0, external: 0, arrayBuffers: 0 };
  const sample = () => {
    const m = process.memoryUsage();
    peak.rss = Math.max(peak.rss, m.rss);
    peak.heap = Math.max(peak.heap, m.heapUsed);
    peak.external = Math.max(peak.external, m.external);
    peak.arrayBuffers = Math.max(peak.arrayBuffers, m.arrayBuffers);
  };
  const timer = setInterval(sample, 10);
  const t0 = performance.now();
  const marks = {};
  const out = await runProtection({ kind: "docx", bytes, password, options: {} }, { createQpdf: async () => { throw new Error("n/a"); } }, { onPhase: (p) => (marks[p] = performance.now() - t0) });
  clearInterval(timer);
  sample();
  const mb = (n) => Math.round(n / 1048576);
  console.log(JSON.stringify({
    inMB: +(bytes.length / 1048576).toFixed(1), outMB: +(out.data.length / 1048576).toFixed(1),
    validateMs: Math.round(marks.encrypting), encryptMs: Math.round(marks.verifying - marks.encrypting), verifyMs: Math.round(marks.completed - marks.verifying), totalMs: Math.round(marks.completed),
    baseRssMB: mb(base.rss), peakRssMB: mb(peak.rss), peakHeapMB: mb(peak.heap), peakExternalMB: mb(peak.external), peakArrayBuffersMB: mb(peak.arrayBuffers),
    extraRssMB: mb(peak.rss - base.rss), extraPerInputMB: +((peak.rss - base.rss) / bytes.length).toFixed(2),
  }));
  process.exit(0);
}

const { makeLargeDocx, makeTestDocx, PASSWORD } = await import("./fixtures.mjs");
const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "protect-profile-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
console.log("| docx size | validate | encrypt | verify | total | peak RSS | extra RSS | peak JS heap | peak ArrayBuffers | extra/input |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const mb of sizes.length ? sizes : [1, 10, 25, 48]) {
  const file = path.join(dir, `d${mb}.docx`);
  // A fixture of about `mb` MB made of incompressible data (built here, then dropped).
  fs.writeFileSync(file, mb <= 1 ? await makeTestDocx({ imageSize: 600 }) : await makeLargeDocx(mb - 0.2));
  const r = spawnSync(process.execPath, ["--expose-gc", "--no-warnings", import.meta.filename, "child", file, PASSWORD], { encoding: "utf8", maxBuffer: 1 << 20 });
  const line = r.stdout.trim().split("\n").pop();
  if (r.status !== 0) { console.log(`| ${mb} MB | FAILED: ${r.stderr.slice(0, 200)} |`); continue; }
  const j = JSON.parse(line);
  console.log(`| ${j.inMB} MB | ${j.validateMs} ms | ${j.encryptMs} ms | ${j.verifyMs} ms | ${j.totalMs} ms | ${j.peakRssMB} MB | +${j.extraRssMB} MB | ${j.peakHeapMB} MB | ${j.peakArrayBuffersMB} MB | ${j.extraPerInputMB}x |`);
  fs.rmSync(file);
}
