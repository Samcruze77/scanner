// The base of a download's file name, taken from the file the person chose.
// "Q3 report.xlsx" -> "Q3 report";  "Résumé – Ọlá (final).pdf" -> "Résumé – Ọlá (final)".
//
// The person's own name is kept, in any language: letters with accents or tone marks
// (Yoruba, Igbo, Hausa, French ...), other scripts, dashes and symbols. Only what Windows,
// macOS or Linux refuse in a file name is replaced: < > : " / \ | ? * and control
// characters. Trailing dots and spaces (refused by Windows) are trimmed. Empty -> fallback.
// (Before, every non-ASCII character became "_", so "Résumé.pdf" downloaded as "R_sum_.docx".)

const FORBIDDEN = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

export function fileBaseName(inputName: string, fallback: string): string {
  const withoutExtension = inputName.replace(/\.[^.]+$/, "");
  const cleaned = Array.from(withoutExtension, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 32 || code === 127 || FORBIDDEN.has(ch) ? "_" : ch;
  })
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return cleaned || fallback;
}
