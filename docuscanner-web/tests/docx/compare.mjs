// Converts fixtures with our engine and compares the result with the PDF Word
// itself produced for the same file.
//
// Run: node tests/docx/compare.mjs [fixture-name-substring] [--png]

import fs from "node:fs";
import path from "node:path";
import { convertFile, fixtures, outDir, sidecarFonts } from "./harness.mjs";
import { extractLines, sideBySide } from "./pdftool.mjs";

const dirArg = process.argv.indexOf("--dir");
// Without --dir: the main fixtures and the page-boundary fixtures.
const fixtureDirs = dirArg >= 0 ? [path.join(fixtures, process.argv[dirArg + 1])] : [fixtures, path.join(fixtures, "boundaries")];
const filter = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--dir") ?? "";
const png = process.argv.includes("--png");
const verbose = process.argv.includes("--verbose");

const jobs = fixtureDirs.flatMap((fixtureDir) =>
  fs
    .readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".docx") && !f.endsWith(".word.docx"))
    .map((f) => f.replace(/\.docx$/, ""))
    .filter((n) => n.includes(filter))
    .map((name) => ({ fixtureDir, name })),
);

let failures = 0;
let skipped = 0;

for (const { fixtureDir, name } of jobs) {
  const fonts = sidecarFonts(path.join(fixtureDir, name + ".docx"));
  if (fonts.missing.length) {
    skipped++;
    console.log(`- ${name.padEnd(20)} SKIPPED: needs font files not installed here (${fonts.missing.map((p) => path.basename(p)).join(", ")})`);
    continue;
  }
  for (const variant of ["", ".word"]) {
    const docx = path.join(fixtureDir, `${name}${variant}.docx`);
    if (!fs.existsSync(docx)) continue;
    const label = `${name}${variant}`;
    let result;
    try {
      result = await convertFile(docx);
    } catch (e) {
      console.log(`✗ ${label}: conversion threw ${e.stack}`);
      failures++;
      continue;
    }
    const oursPath = path.join(outDir, `${label}.pdf`);
    fs.writeFileSync(oursPath, result.bytes);
    const wordPath = path.join(fixtureDir, `${name}.word.pdf`);
    const ref = await extractLines(wordPath);
    const ours = await extractLines(oursPath);

    const report = [];
    report.push(`pages ${ours.length} vs Word ${ref.length}`);
    let lineDiffs = 0;
    let compared = 0;
    let maxDy = 0;
    let sumDy = 0;
    let maxDx = 0;
    let sizeMismatch = 0;
    let textMismatch = 0;
    const worst = [];
    const pageCount = Math.min(ours.length, ref.length);
    for (let p = 0; p < pageCount; p++) {
      const a = ref[p].lines;
      const b = ours[p].lines;
      // Match lines by their text (Word and ours split lines identically when wrapping agrees).
      const used = new Set();
      for (const la of a) {
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < b.length; i++) {
          if (used.has(i)) continue;
          const same = normalize(b[i].text) === normalize(la.text);
          const score = Math.abs(b[i].y - la.y) + (same ? 0 : 1000);
          if (score < bestScore) {
            bestScore = score;
            best = i;
          }
        }
        if (best < 0) {
          textMismatch++;
          continue;
        }
        used.add(best);
        const lb = b[best];
        compared++;
        if (normalize(lb.text) !== normalize(la.text)) {
          textMismatch++;
          worst.push(`p${p + 1} text: W "${la.text.slice(0, 50)}" / O "${lb.text.slice(0, 50)}"`);
          continue;
        }
        const dy = lb.y - la.y;
        const dx = lb.x - la.x;
        maxDy = Math.max(maxDy, Math.abs(dy));
        maxDx = Math.max(maxDx, Math.abs(dx));
        sumDy += Math.abs(dy);
        if (Math.abs(lb.size - la.size) > 0.3) sizeMismatch++;
        if (Math.abs(dy) > 1 || Math.abs(dx) > 1) {
          lineDiffs++;
          worst.push(`p${p + 1} y ${la.y.toFixed(1)}→${lb.y.toFixed(1)} (${dy > 0 ? "+" : ""}${dy.toFixed(1)}) x ${la.x.toFixed(1)}→${lb.x.toFixed(1)}  "${la.text.slice(0, 40)}"`);
        }
      }
      // Lines we have that Word doesn't.
      for (let i = 0; i < b.length; i++) if (!used.has(i)) {
        textMismatch++;
        worst.push(`p${p + 1} extra line in ours: "${b[i].text.slice(0, 50)}"`);
      }
    }
    const ok = ours.length === ref.length && textMismatch === 0 && lineDiffs === 0 && sizeMismatch === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? "✓" : "✗"} ${label.padEnd(20)} ${report.join(", ")}; lines ${compared}, Δy>1pt ${lineDiffs}, text≠ ${textMismatch}, size≠ ${sizeMismatch}, mean|Δy| ${compared ? (sumDy / compared).toFixed(2) : "-"}, max|Δy| ${maxDy.toFixed(1)}, max|Δx| ${maxDx.toFixed(1)}${result.warnings.length ? `  [warnings: ${result.warnings.length}]` : ""}`,
    );
    if (verbose || !ok) for (const w of worst.slice(0, verbose ? 60 : 6)) console.log("     " + w);
    if (verbose) for (const w of result.warnings) console.log("     warn: " + w);
    if (png && variant === "") {
      const outs = await sideBySide(wordPath, oursPath, path.join(outDir, label), 0.9);
      console.log("     " + outs.map((o) => path.basename(o)).join(" "));
    }
  }
}

// Whitespace is ignored, and a run of leader dots counts as one (the number of
// dots is cosmetic).
function normalize(s) {
  return s.replace(/\s+/g, "").replace(/\.{4,}/g, "...").toLowerCase();
}

if (skipped) console.log(`\n${skipped} fixture(s) skipped because their real font files are not installed on this machine.`);
console.log(failures === 0 ? "\nAll fixtures match Word within tolerance." : `\n${failures} variant(s) differ from Word.`);
process.exitCode = failures === 0 ? 0 : 1;
