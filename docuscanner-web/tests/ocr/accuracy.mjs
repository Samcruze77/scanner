// OCR character-accuracy experiment. Renders synthetic pages (identifier-style strings that mix letters and
// digits, plus ordinary sentences) in several fonts, sizes and image qualities, reads them with the SAME
// Tesseract model the app ships (eng "best int") under different settings, and scores each line by
// character-level accuracy (1 - edit distance / length). It also counts the 0<->O (and 1<->l/I) swaps.
//   node tests/ocr/accuracy.mjs [config names, comma separated]      (several minutes; Node only, no server)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { applyCodeFormat } from "../../utils/ocr/identifiers.ts";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { createWorker } = require("tesseract.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const langPath = path.join(here, "..", "..", "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");

// ---- ground truth ---------------------------------------------------------------------------------
const IDS = ["INV-2026-0042", "AB0123O45", "SKU-9912-OO", "REF O0O0 1l1I", "ID 100200300", "PO-0O-2O26", "BOOK COOL ROOM", "Room 101 Floor 20"];
const WORDS = ["The quick brown fox jumps over the lazy dog", "Total amount due 1234.56 EUR by 30 November"];
const FONTS = ["Arial", "Courier New", "Times New Roman", "Verdana", "Consolas"];
const SIZES = [20, 28, 40]; // px on a 200 dpi A4 page (about 7, 10, 14 pt)
const QUALITIES = ["clean", "blur", "noisy"];
const REPORT_GROUPS = [...QUALITIES, "audit-scan"];

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function page(font, quality) {
  const W = 1654, H = 2339;
  const c = createCanvas(W, H);
  const x = c.getContext("2d");
  x.fillStyle = "#fff";
  x.fillRect(0, 0, W, H);
  x.fillStyle = "#111";
  const lines = [];
  let y = 120;
  for (const size of SIZES) {
    x.font = `${size}px "${font}"`;
    for (const t of [...IDS, ...WORDS]) {
      x.fillText(t, 100, y);
      lines.push({ text: t, id: IDS.includes(t), size });
      y += size * 2.1;
    }
    y += 30;
  }
  let img = c;
  if (quality === "blur") {
    // A soft, slightly out-of-focus scan: shrink and enlarge again.
    const small = createCanvas(Math.round(W * 0.62), Math.round(H * 0.62));
    small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
    img = createCanvas(W, H);
    img.getContext("2d").drawImage(small, 0, 0, W, H);
  }
  let buf;
  if (quality === "noisy") {
    const d = x.getImageData(0, 0, W, H);
    for (let i = 0; i < d.data.length; i += 4) {
      const n = (rand() - 0.5) * 60;
      d.data[i] = Math.min(255, Math.max(0, d.data[i] + n));
      d.data[i + 1] = Math.min(255, Math.max(0, d.data[i + 1] + n));
      d.data[i + 2] = Math.min(255, Math.max(0, d.data[i + 2] + n));
    }
    x.putImageData(d, 0, 0);
    buf = c.toBuffer("image/jpeg", 45);
  } else {
    buf = img.toBuffer("image/jpeg", 90);
  }
  return { buf, lines };
}

// ---- scoring --------------------------------------------------------------------------------------
function edits(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  // trace substitutions
  const subs = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1]) subs.push([a[i - 1], b[j - 1]]);
      i--;
      j--;
    } else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return { dist: d[m][n], subs };
}
function score(expected, outputLines) {
  const pool = outputLines.map((t) => t.trim()).filter(Boolean);
  const res = [];
  for (const e of expected) {
    let best = null;
    for (let k = 0; k < pool.length; k++) {
      const r = edits(e.text, pool[k]);
      if (!best || r.dist < best.r.dist) best = { k, r };
    }
    const r = best ? best.r : { dist: e.text.length, subs: [] };
    res.push({ ...e, got: best ? pool[best.k] : "", dist: r.dist, subs: r.subs, acc: Math.max(0, 1 - r.dist / e.text.length) });
  }
  return res;
}

// ---- configurations (how the page is prepared and the engine set up) ----------------------------------------
const CONFIGS = {
  // What the app does today: long side scaled to 2400 px, default engine settings.
  baseline: { longSide: 2400 },
  upscale: { longSide: 3400 },
  dpi300: { longSide: 2400, params: { user_defined_dpi: "300" } },
  upscaleDpi: { longSide: 3400, params: { user_defined_dpi: "300" } },
  noDict: { longSide: 2400, init: { load_system_dawg: "0", load_freq_dawg: "0" } },
  block: { longSide: 2400, params: { tessedit_pageseg_mode: "6" } },
  upscaleBlock: { longSide: 3400, params: { tessedit_pageseg_mode: "6", user_defined_dpi: "300" } },
};

async function runConfig(name, cfg, pages) {
  const worker = await createWorker("eng", 1, { langPath, cachePath: path.join(os.tmpdir(), "ocr-cache"), logger: () => {} }, cfg.init ?? {});
  if (cfg.params) await worker.setParameters(cfg.params);
  const all = [];
  for (const p of pages) {
    const img = await loadImage(p.buf);
    const k = cfg.longSide / Math.max(img.width, img.height);
    const c = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
    const cx = c.getContext("2d");
    cx.imageSmoothingQuality = "high";
    cx.drawImage(img, 0, 0, c.width, c.height);
    const { data } = await worker.recognize(c.toBuffer("image/png"));
    // FORMAT=AAAA-A99 also applies the explicit code-format clean-up to the audit scan page only.
    const outLines = data.text.split("\n").map((l) => (process.env.FORMAT && p.quality === "audit-scan" ? applyCodeFormat(l, process.env.FORMAT).text : l));
    const scored = score(p.lines, outLines);
    all.push(...scored.map((s) => ({ ...s, font: p.font, quality: p.quality })));
  }
  await worker.terminate();
  if (process.env.SHOW_SCAN) for (const r of all.filter((x) => x.quality === "audit-scan" && x.dist > 0)) console.log(`   expected: ${r.text}
   read:     ${r.got}`);
  return all;
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
function summary(rows) {
  const ids = rows.filter((r) => r.id), words = rows.filter((r) => !r.id);
  const swaps = (list, from, to) => list.reduce((n, r) => n + r.subs.filter(([a, b]) => a === from && b === to).length, 0);
  return {
    ids: +(mean(ids.map((r) => r.acc)) * 100).toFixed(2),
    words: +(mean(words.map((r) => r.acc)) * 100).toFixed(2),
    zeroToO: swaps(ids, "0", "O") + swaps(ids, "0", "o"),
    oToZero: swaps(ids, "O", "0"),
    oneSwaps: swaps(ids, "1", "l") + swaps(ids, "1", "I") + swaps(ids, "l", "1") + swaps(ids, "I", "1") + swaps(ids, "l", "I") + swaps(ids, "I", "l"),
    idChars: ids.reduce((n, r) => n + r.text.length, 0),
  };
}

const wanted = (process.argv[2] ?? Object.keys(CONFIGS).join(",")).split(",");
const pages = [];
for (const font of FONTS) for (const quality of QUALITIES) pages.push({ ...page(font, quality), font, quality });
// The audit's own scan (tests/audit/corpus/scan.jpg: A4 at 200 dpi, 22 px and 30 px Arial lines like "SCAN-L01 The quick brown fox...").
const scanFile = path.join(here, "..", "audit", "corpus", "scan.jpg");
if (fs.existsSync(scanFile)) {
  const sentences = ["The quick brown fox jumps over the lazy dog", "Pack my box with five dozen liquor jugs", "Total amount due 1234.56 EUR by 30 November"];
  const lines = [{ text: "SCAN-TITLE Invoice 2026-0042", id: true, size: 44 }, ...Array.from({ length: 24 }, (_, i) => ({ text: `SCAN-L${String(i + 1).padStart(2, "0")} ${sentences[i % 3]}`, id: true, size: i % 3 === 0 ? 22 : 30 }))];
  pages.push({ buf: fs.readFileSync(scanFile), lines, font: "audit scan.jpg", quality: "audit-scan" });
}
console.log(`Fixtures: ${pages.length} pages (${FONTS.length} fonts x ${QUALITIES.length} qualities), ${pages.length * pages[0].lines.length} lines`);
const out = {};
for (const name of wanted) {
  const t0 = Date.now();
  const rows = await runConfig(name, CONFIGS[name], pages);
  out[name] = { byString: Object.fromEntries([...IDS, ...WORDS].map((t) => [t, +(mean(rows.filter((r) => r.text === t).map((r) => r.acc)) * 100).toFixed(1)])), overall: summary(rows), byQuality: Object.fromEntries(REPORT_GROUPS.map((q) => [q, summary(rows.filter((r) => r.quality === q))])), bySize: Object.fromEntries(SIZES.map((s) => [s, summary(rows.filter((r) => r.size === s))])), byFont: Object.fromEntries(FONTS.map((f) => [f, summary(rows.filter((r) => r.font === f))])) };
  const o = out[name].overall;
  if (process.env.SHOW_STRINGS) console.log(JSON.stringify(out[name].byString, null, 1));
  console.log(`${name.padEnd(14)} ids ${o.ids}%  words ${o.words}%  0->O ${o.zeroToO}  O->0 ${o.oToZero}  1/l/I swaps ${o.oneSwaps}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
fs.writeFileSync(path.join(here, "accuracy-results.json"), JSON.stringify(out, null, 2));
