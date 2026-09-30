// Memory and timing of Protect PDF (QPDF WebAssembly) in a CLEAN process per size.
//   node tests/protect/profile-pdf.mjs [sizeMB ...]        default: 10 25 50 100
// Reports, separately, the file-selection check and the protect run, with process memory peaks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const mb = (n) => Math.round(n / 1048576);

if (process.argv[2] === "child") {
  const file = process.argv[3];
  const require = createRequire(import.meta.url);
  const createModule = require("@neslinesli93/qpdf-wasm");
  const wasm = path.join(root, "node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm");
  const { runProtection } = await import("../../utils/protect/operation.ts");
  const peaks = () => {
    const p = { rss: 0, heap: 0, ab: 0 };
    const sample = () => { const m = process.memoryUsage(); p.rss = Math.max(p.rss, m.rss); p.heap = Math.max(p.heap, m.heapUsed); p.ab = Math.max(p.ab, m.arrayBuffers + m.external); };
    const timer = setInterval(sample, 10);
    return { stop: () => { clearInterval(timer); sample(); return p; } };
  };
  const bytes = new Uint8Array(fs.readFileSync(file));
  const base = process.memoryUsage().rss;
  const out = {};
  // 1. what choosing the file does in the browser (checkProtectFile): a scan of the file's two ends
  {
    const { mentionsEncrypt, SCAN_BYTES } = await import("../../utils/protect/protect.ts");
    const s = peaks();
    const t = performance.now();
    const ends = new Uint8Array(Math.min(bytes.length, 2 * SCAN_BYTES));
    ends.set(bytes.subarray(0, Math.min(bytes.length, SCAN_BYTES)));
    if (bytes.length > SCAN_BYTES) ends.set(bytes.subarray(bytes.length - SCAN_BYTES), bytes.length > 2 * SCAN_BYTES ? SCAN_BYTES : 0);
    mentionsEncrypt(ends);
    out.selectMs = Math.round(performance.now() - t);
    out.select = s.stop();
    global.gc?.();
  }
  // 2. the protect run
  {
    const s = peaks();
    const marks = {};
    const t = performance.now();
    try {
      const res = await runProtection({ kind: "pdf", bytes, password: "TestPassword123!", options: { allowPrint: true, allowCopy: true, allowEdit: false } }, { createQpdf: async () => createModule({ locateFile: () => wasm, noInitialRun: true, print: () => {}, printErr: () => {} }) }, { onPhase: (p) => (marks[p] = performance.now() - t) });
      out.ok = true; out.outMB = +(res.data.length / 1048576).toFixed(1);
    } catch (e) { out.ok = false; out.error = e.code ?? String(e.message).slice(0, 80); }
    out.runMs = Math.round(performance.now() - t);
    out.run = s.stop();
  }
  out.inMB = +(bytes.length / 1048576).toFixed(1);
  out.baseMB = mb(base);
  console.log(JSON.stringify(out));
  process.exit(0);
}

const { makeLargePdf } = await import("./fixtures.mjs");
const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "protect-pdf-profile-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
console.log("| pdf | select: time | select: peak RSS | protect: time | protect: peak RSS | extra vs idle | extra / input | result |\n|---|---:|---:|---:|---:|---:|---:|---|");
for (const size of sizes.length ? sizes : [10, 25, 50, 100]) {
  const file = path.join(dir, `p${size}.pdf`);
  fs.writeFileSync(file, await makeLargePdf(size));
  const r = spawnSync(process.execPath, ["--expose-gc", "--no-warnings", import.meta.filename, "child", file], { encoding: "utf8", maxBuffer: 1 << 20, timeout: 900000 });
  const line = r.stdout.trim().split("\n").pop();
  if (r.status !== 0 || !line.startsWith("{")) { console.log(`| ${size} MB | crashed: ${(r.stderr || `signal ${r.signal}`).slice(0, 160).replace(/\n/g, " ")} |`); fs.rmSync(file); continue; }
  const j = JSON.parse(line);
  const extra = mb(Math.max(j.select.rss, j.run.rss)) - j.baseMB;
  console.log(`| ${j.inMB} MB | ${j.selectMs} ms | ${mb(j.select.rss)} MB | ${j.runMs} ms | ${mb(j.run.rss)} MB | +${extra} MB | ${(extra / j.inMB).toFixed(1)}x | ${j.ok ? "protected" : "refused: " + j.error} |`);
  fs.rmSync(file);
}
