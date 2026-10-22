// Builds tests/docx/fixtures/autofit/autofit.docx on the fly: tables with NO cell widths, so Word sizes the columns from their
// content (see utils/convert/docx/flow.ts autofitColumns). tests/docx/autofit.mjs converts it and compares with Word's own PDF of the
// same file (fixtures/autofit/autofit.word.pdf, exported from Word with ExportAsFixedFormat).
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const long = (n) => Array.from({ length: n }, (_, i) => "word" + (i % 10)).join(" ");
// cell: string | {t, span, jc}; table: {w:"auto"|"dxa:N"|"pct:N", rows:[[cells]], grid?:[..], borders?:bool}
const tables = {
  A_fit_dxa8000: { w: "dxa:8000", rows: [["aa", "bbbb bbbb", "c"]] },
  B_fit_auto: { w: "auto", rows: [["aa", "bbbb bbbb", "c"]] },
  C_fit_pct100: { w: "pct:5000", rows: [["aa", "bbbb bbbb", "c"]] },
  D_over_one_long: { w: "dxa:8000", rows: [["aa", long(30), "c"]] },
  E_over_two_long: { w: "dxa:8000", rows: [["x " + long(12), long(30), "c"]] },
  F_merge_row: { w: "dxa:8000", rows: [[{ t: "spanning text that is long enough", span: 2 }, "z"], ["a", "b", "c"]] },
  G_wide_dxa9360: { w: "dxa:9360", rows: [["aa", "bbbb bbbb", "c"]] },
  H_borders: { w: "dxa:8000", borders: true, rows: [["aa", "bbbb bbbb", "c"]] },
  I_over_borders: { w: "dxa:8000", borders: true, rows: [["aa", long(30), "c"]] },
  J_two_rows: { w: "dxa:8000", rows: [["a", "bbbb", "cccccccc"], ["aaaaaaaa", "bb", "c"]] },
  K_over_auto: { w: "auto", rows: [["aa", long(40), "c"]] },
  L_long_word: { w: "dxa:8000", rows: [["aa", "x".repeat(60), long(30)]] },

  O1_10_30: { w: "dxa:8000", rows: [[long(10), long(30), "c"]] },
  O2_20_20: { w: "dxa:8000", rows: [[long(20), long(20), "c"]] },
  O3_5_30: { w: "dxa:8000", rows: [[long(5), long(30), "c"]] },
  O4_30_30: { w: "dxa:8000", rows: [[long(30), long(30), "c"]] },
  O5_15_45: { w: "dxa:8000", rows: [[long(15), long(45), "c"]] },
  O6_two_cols_10_30: { w: "dxa:8000", rows: [[long(10), long(30)]] },
  O7_three_wide: { w: "dxa:8000", rows: [[long(10), long(20), long(30)]] },
  O8_auto_10_30: { w: "auto", rows: [[long(10), long(30)]] },
  O9_words_mix: { w: "dxa:8000", rows: [["alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega", "short text here"]] },
};
const cellXml = (c) => {
  const o = typeof c === "string" ? { t: c } : c;
  return `<w:tc><w:tcPr>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ""}</w:tcPr><w:p>${o.jc ? `<w:pPr><w:jc w:val="${o.jc}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(o.t)}</w:t></w:r></w:p></w:tc>`;
};
let body = "";
for (const [name, t] of Object.entries(tables)) {
  const cols = Math.max(...t.rows.map((r) => r.reduce((n, c) => n + (c.span ?? 1), 0)));
  const [kind, val] = t.w.split(":");
  const tblW = kind === "auto" ? `<w:tblW w:w="0" w:type="auto"/>` : kind === "dxa" ? `<w:tblW w:w="${val}" w:type="dxa"/>` : `<w:tblW w:w="${val}" w:type="pct"/>`;
  const b = t.borders ? "<w:tblBorders>" + ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="000000"/>`).join("") + "</w:tblBorders>" : "";
  const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.round(9026 / cols)}"/>`).join("");
  body += `<w:p><w:r><w:t>${name}</w:t></w:r></w:p><w:tbl><w:tblPr>${tblW}${b}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${t.rows.map((r) => `<w:tr>${r.map(cellXml).join("")}</w:tr>`).join("")}</w:tbl>`;
}
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const zip = new JSZip();
zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`);
zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);

export async function writeAutofitFixture(file) {
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
}
