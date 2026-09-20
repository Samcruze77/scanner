// Prints Word's lines and ours side by side for one fixture: node tests/docx/dump.mjs <name> [variant]
import { extractLines } from "./pdftool.mjs";
const [name, variant = ""] = process.argv.slice(2);
const ref = await extractLines(`tests/docx/fixtures/${name}.word.pdf`);
const ours = await extractLines(`tests/docx/out/${name}${variant}.pdf`);
for (let p = 0; p < Math.max(ref.length, ours.length); p++) {
  console.log(`=== page ${p + 1}`);
  const a = ref[p]?.lines ?? [], b = ours[p]?.lines ?? [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const l = a[i], o = b[i];
    console.log(`${l ? `${l.y.toFixed(1).padStart(6)} x${l.x.toFixed(1).padStart(6)} s${l.size.toFixed(1).padStart(4)} ${l.text.slice(0, 34).padEnd(34)}` : " ".repeat(54)} | ${o ? `${o.y.toFixed(1).padStart(6)} x${o.x.toFixed(1).padStart(6)} s${o.size.toFixed(1).padStart(4)} ${o.text.slice(0, 34)}` : ""}`);
  }
}
