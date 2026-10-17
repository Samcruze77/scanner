// Optional, explicit clean-up of look-alike characters in codes read by OCR (for example "SCAN-LO1" that should
// be "SCAN-L01").
//
// The OCR engine decides between 0 and O (and 1 and I) from the characters around them, and both readings are
// valid text, so nothing is ever replaced automatically: "BOOK COOL ROOM", "Room 101" and "PO-0O-2O26" must all
// come out as they are written. This only runs when the person types the format of their codes, and then only
// changes a word that has EXACTLY the length of that format and fits it apart from look-alike characters.
//
// Format: "A" = a letter, "9" = a digit, any other character is written as it is. "AAAA-A99" matches SCAN-L01.
//   at a digit position:  O o -> 0     I l | -> 1
//   at a letter position: 0 -> O       1 -> I        (upper-case codes)
// A word that does not fit the format (wrong length, a different character, a letter where a digit must be
// that is not a look-alike) is left untouched. Pure string logic, so it can be tested without a browser.

const TO_DIGIT: Record<string, string> = { O: "0", o: "0", I: "1", l: "1", "|": "1" };
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I" };
const TRAILING = /[.,;:!?)\]]+$/;

export const MIN_PATTERN_LENGTH = 3;
export const MAX_PATTERN_LENGTH = 40;

export function isValidCodeFormat(pattern: string): boolean {
  return pattern.length >= MIN_PATTERN_LENGTH && pattern.length <= MAX_PATTERN_LENGTH && /[A9]/.test(pattern) && !/\s/.test(pattern);
}

export interface CodeFormatResult {
  text: string;
  // Words that fitted the format.
  matched: number;
  // Characters that were changed.
  changed: number;
}

// Returns the fixed word, or null if the word does not fit the format.
function fixWord(word: string, pattern: string): { word: string; changed: number } | null {
  if (word.length !== pattern.length) return null;
  let changed = 0;
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const p = pattern[i];
    const c = word[i];
    if (p === "9") {
      if (/[0-9]/.test(c)) out += c;
      else if (TO_DIGIT[c]) {
        out += TO_DIGIT[c];
        changed++;
      } else return null;
    } else if (p === "A") {
      if (/[A-Za-z]/.test(c)) out += c;
      else if (TO_LETTER[c]) {
        out += TO_LETTER[c];
        changed++;
      } else return null;
    } else if (c === p) out += c;
    else return null;
  }
  return { word: out, changed };
}

export function applyCodeFormat(text: string, pattern: string): CodeFormatResult {
  if (!isValidCodeFormat(pattern)) return { text, matched: 0, changed: 0 };
  let matched = 0;
  let changed = 0;
  const out = text.replace(/\S+/g, (token) => {
    const tail = (token.match(TRAILING) ?? [""])[0];
    const core = tail ? token.slice(0, -tail.length) : token;
    const fixed = fixWord(core, pattern);
    if (!fixed) return token;
    matched++;
    changed += fixed.changed;
    return fixed.word + tail;
  });
  return { text: out, matched, changed };
}
