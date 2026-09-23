// Unit tests for utils/convert/toCsv.ts's RFC 4180 quoting/escaping.
// Run: node tests/pdf2excel/csv.mjs

import { rowsToCsv, ocrTextToCsv } from "../../utils/convert/toCsv.ts";

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

check("plain fields, no quoting needed", rowsToCsv([["a", "b", "c"]]), "a,b,c");
check("comma triggers quoting", rowsToCsv([["a,b", "c"]]), '"a,b",c');
check("quote is doubled and field quoted", rowsToCsv([['say "hi"']]), '"say ""hi"""');
check("embedded newline triggers quoting", rowsToCsv([["line1\nline2"]]), '"line1\nline2"');
check("multiple rows joined with CRLF", rowsToCsv([["a"], ["b"]]), "a\r\nb");
check("empty field stays empty, unquoted", rowsToCsv([["", "x"]]), ",x");
check("ocrTextToCsv: one line per row, blanks dropped", ocrTextToCsv("Hello\n\nWorld, 2026\n"), "Hello\r\n\"World, 2026\"");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
