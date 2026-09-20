// Compares any PDF against Word's reference PDF: node tests/docx/compare-file.mjs <ours.pdf> <word.pdf>
import { extractLines } from "./pdftool.mjs";
const [oursPath, wordPath] = process.argv.slice(2);
const ref = await extractLines(wordPath);
const ours = await extractLines(oursPath);
const norm = (s) => s.replace(/\s+/g, "").replace(/\.{4,}/g, "...").toLowerCase();
let compared = 0, textDiff = 0, maxDy = 0, maxDx = 0, sum = 0;
console.log(`pages ${ours.length} vs Word ${ref.length}`);
for (let p = 0; p < Math.min(ours.length, ref.length); p++) {
  const used = new Set();
  for (const la of ref[p].lines) {
    let best = -1, bs = Infinity;
    ours[p].lines.forEach((lb, i) => { if (used.has(i)) return; const sc = Math.abs(lb.y - la.y) + (norm(lb.text) === norm(la.text) ? 0 : 1000); if (sc < bs) { bs = sc; best = i; } });
    if (best < 0) { textDiff++; continue; }
    used.add(best);
    const lb = ours[p].lines[best]; compared++;
    if (norm(lb.text) !== norm(la.text)) { textDiff++; console.log("  text differs:", la.text.slice(0, 40), "|", lb.text.slice(0, 40)); continue; }
    const dy = Math.abs(lb.y - la.y), dx = Math.abs(lb.x - la.x);
    maxDy = Math.max(maxDy, dy); maxDx = Math.max(maxDx, dx); sum += dy;
  }
}
console.log(`lines compared ${compared}, text differences ${textDiff}, mean|dy| ${(sum / compared).toFixed(2)}pt, max|dy| ${maxDy.toFixed(2)}pt, max|dx| ${maxDx.toFixed(2)}pt`);
