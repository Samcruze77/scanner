// Runs after every `next build` (the "postbuild" script in package.json) and FAILS the
// build if the compiled stylesheet is missing the theme system.
//
// Why: a stale build cache once let production ship new pages with an old stylesheet, so
// the theme menu changed the `data-theme` attribute but no colour changed. Everything
// looked fine to unit checks and only a real browser showed it. Failing the build is far
// better than shipping that: the previous good deployment keeps serving.
//
// It checks the CSS Next actually emitted, not the source file.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = join(root, ".next", "static");

function cssFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...cssFiles(full));
    else if (name.endsWith(".css")) found.push(full);
  }
  return found;
}

let files;
try {
  files = cssFiles(staticDir);
} catch {
  console.error("[verify-theme-css] No build output found in .next/static. Run `next build` first.");
  process.exit(1);
}
const css = files.map((f) => readFileSync(f, "utf8")).join("\n");

// Each check names what would be visibly broken if it were missing.
const CHECKS = [
  [/\[data-theme=["']?soft["']?\]/, "Soft Gray palette (:root[data-theme=soft])"],
  [/\[data-theme=["']?dark["']?\]\s*\{/, "Dark palette (:root[data-theme=dark])"],
  [/--page:\s*#fafafa/i, "Light palette tokens (--page)"],
  [/\.bg-surface\b/, "surface utility (bg-surface)"],
  [/\.bg-chrome\b/, "header utility (bg-chrome)"],
  [/\.bg-elevated\b/, "dialog utility (bg-elevated)"],
  [/data-theme=["']?dark["']?\][^{]*\)\s*\{/, "dark: utilities scoped to the Dark theme"],
];

const missing = CHECKS.filter(([re]) => !re.test(css)).map(([, what]) => what);
// The old system followed the operating system directly. If it is back, an explicit
// Light or Soft Gray choice would be overridden by the OS's dark setting.
const osDark = /@media\s*\(prefers-color-scheme:\s*dark\)/.test(css);

if (missing.length > 0 || osDark) {
  console.error("\n[verify-theme-css] The compiled stylesheet does not contain the theme system:");
  for (const what of missing) console.error(`  - missing: ${what}`);
  if (osDark) console.error("  - found @media (prefers-color-scheme: dark) rules that would override an explicit theme choice");
  console.error(`  (checked ${files.length} file(s) in .next/static; likely a stale build cache -- retry with a clean build)\n`);
  process.exit(1);
}
console.log(`[verify-theme-css] OK: theme rules present in ${files.length} stylesheet(s).`);
