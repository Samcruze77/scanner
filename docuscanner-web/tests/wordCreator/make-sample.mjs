// Writes the synthetic document as a .docx, for opening in real Word:  node --import ./tests/scanner/register.mjs tests/wordCreator/make-sample.mjs out.docx
import fs from "node:fs";
import { exportDocx } from "../../utils/wordCreator/docxExport.ts";
import { makePicture, syntheticDocument } from "./fixtures.mjs";
const out = process.argv[2] ?? "sample.docx";
fs.writeFileSync(out, await exportDocx(syntheticDocument(makePicture("png"), makePicture("jpeg", 400, 300, "#007040")), { title: "My Report" }));
console.log(out);
