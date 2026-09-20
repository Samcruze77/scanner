import { sideBySide } from "./pdftool.mjs";
const [ours, word, out] = process.argv.slice(2);
console.log((await sideBySide(word, ours, out, 0.9)).join("\n"));
