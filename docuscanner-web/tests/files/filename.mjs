// Download names keep the person's own file name, in any language, and stay valid on every OS.
//   node --no-warnings tests/files/filename.mjs
import assert from "node:assert/strict";
import { fileBaseName } from "../../utils/files/filename.ts";
import { protectedFilename } from "../../utils/protect/protect.ts";

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log("  ok ", name);
  } catch (e) {
    failed++;
    console.log("  FAIL", name, "\n      ", e.message);
  }
};

check("plain names are unchanged (what existing downloads were called)", () => {
  assert.equal(fileBaseName("Q3 report.xlsx", "x"), "Q3 report");
  assert.equal(fileBaseName("contract.docx", "x"), "contract");
  assert.equal(protectedFilename("report.pdf"), "report-protected.pdf");
});
check("accents, tone marks, other scripts and symbols are kept (they used to become _)", () => {
  assert.equal(fileBaseName("Résumé – Q3 (final) #2 名前.pdf", "x"), "Résumé – Q3 (final) #2 名前");
  assert.equal(fileBaseName("Ọlá Àdìgún ìwé.pdf", "x"), "Ọlá Àdìgún ìwé");
  assert.equal(fileBaseName("Ụlọ akwụkwọ.docx", "x"), "Ụlọ akwụkwọ");
  assert.equal(fileBaseName("Takardar ƙasa.xlsx", "x"), "Takardar ƙasa");
  assert.equal(fileBaseName("Отчёт.pdf", "x"), "Отчёт");
});
check("characters Windows / macOS / Linux refuse are replaced, and only those", () => {
  assert.equal(fileBaseName('a<b>c:d"e|f?g*h.pdf', "x"), "a_b_c_d_e_f_g_h");
  assert.equal(fileBaseName("tab" + String.fromCharCode(9) + "and" + String.fromCharCode(1) + "ctl.pdf", "x"), "tab_and_ctl");
});
check("trailing dots and spaces are trimmed; nothing left -> the fallback", () => {
  assert.equal(fileBaseName("notes. .pdf", "x"), "notes");
  assert.equal(fileBaseName(".pdf", "document"), "document");
  assert.equal(fileBaseName("   .pdf", "document"), "document");
  assert.equal(protectedFilename(".pdf"), "document-protected.pdf");
});

console.log(failed ? `${failed} failed` : "all filename checks passed");
process.exit(failed ? 1 : 0);
