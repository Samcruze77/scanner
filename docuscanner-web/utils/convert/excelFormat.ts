// Excel-style display formatting for cell values. ExcelJS hands back raw
// numbers and Dates and leaves number formats to the caller, so "$4.50" comes
// through as 4.5 and dates as JS Dates. This covers the formats real
// spreadsheets use (General, fixed/thousands/percent/scientific, currency,
// negatives in parentheses, and the common date/time patterns) and falls back
// to General for anything more exotic rather than failing.
//
// Dependency-free on purpose.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Splits a format into its ;-separated sections, ignoring ; inside quotes or
// brackets.
function splitSections(format: string): string[] {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  let bracketed = false;
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === "\\") {
      current += ch + (format[i + 1] ?? "");
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (ch === "[" && !quoted) {
      bracketed = true;
      current += ch;
    } else if (ch === "]" && !quoted) {
      bracketed = false;
      current += ch;
    } else if (ch === ";" && !quoted && !bracketed) {
      sections.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  sections.push(current);
  return sections;
}

// Format text with quoted literals, [bracketed] modifiers and escapes removed,
// used only to decide what kind of format it is.
function stripLiterals(section: string): string {
  return section.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").replace(/_./g, "");
}

export function isDateFormat(format: string | undefined): boolean {
  if (!format || format.toLowerCase() === "general") return false;
  const core = stripLiterals(splitSections(format)[0]);
  // "E+" scientific and "General" aside, any date/time letter marks a date.
  return /[ymdhs]/i.test(core) && !/^[#0?,.%\s]*e[+-]/i.test(core);
}

function generalNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const text = String(parseFloat(value.toPrecision(10)));
  return text;
}

function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatWithPattern(value: number, section: string, treatAsNegative: boolean): string {
  // Currency codes like [$EUR-407] contribute their symbol; other brackets
  // (colours, conditions) are dropped.
  let text = section.replace(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g, (_, symbol: string) => `"${symbol}"`);
  text = text.replace(/\[[^\]]*\]/g, "");

  const percent = /%/.test(stripLiterals(text));
  let n = Math.abs(value);
  if (percent) n *= 100;

  // Scientific: 0.00E+00
  const sci = /([#0?]*)\.?([#0?]*)E([+-])([0]+)/i.exec(stripLiterals(text));
  if (sci) {
    const decimals = sci[2].length;
    const [mantissa, exponent] = n.toExponential(decimals).split("e");
    const expNumber = Number(exponent);
    const sign = expNumber < 0 ? "-" : sci[3] === "+" ? "+" : "";
    return (treatAsNegative ? "-" : "") + mantissa + "E" + sign + String(Math.abs(expNumber)).padStart(sci[4].length, "0");
  }

  // Locate the numeric pattern (#,##0.00) in the section, outside literals.
  const marker = String.fromCharCode(0);
  const shielded = text
    .replace(/"[^"]*"/g, (m) => marker.repeat(m.length))
    .replace(/\\./g, (m) => marker.repeat(m.length))
    .replace(/_./g, (m) => marker.repeat(m.length));
  const match = /[#0?][#0?,]*(?:\.[#0?]*)?|\.[#0?]+/.exec(shielded);

  let numeric = "";
  let start = 0;
  let end = 0;
  if (match) {
    start = match.index;
    end = start + match[0].length;
    const pattern = match[0];
    const [intPattern, decPattern = ""] = pattern.split(".");
    const thousands = intPattern.includes(",");
    const maxDecimals = decPattern.replace(/,/g, "").length;
    const minDecimals = (decPattern.match(/[0?]/g) ?? []).length;
    const minInt = (intPattern.match(/0/g) ?? []).length;

    // Round half away from zero (toFixed rounds the binary value, which
    // surprises: (1.005).toFixed(2) is "1.00").
    const scale = 10 ** maxDecimals;
    const rounded = Math.round((n + Number.EPSILON) * scale) / scale;
    let [intDigits, decDigits = ""] = rounded.toFixed(maxDecimals).split(".");
    while (decDigits.length > minDecimals && decDigits.endsWith("0")) decDigits = decDigits.slice(0, -1);
    if (minInt === 0 && intDigits === "0" && (decDigits.length > 0 || maxDecimals > 0)) intDigits = "";
    intDigits = intDigits.padStart(minInt, "0");
    if (thousands) intDigits = groupThousands(intDigits);
    numeric = intDigits + (decDigits ? `.${decDigits}` : "");
  }

  const before = text.slice(0, start);
  const after = text.slice(end);
  const literal = (chunk: string) =>
    chunk
      .replace(/"([^"]*)"/g, "$1")
      .replace(/\\(.)/g, "$1")
      .replace(/_(.)/g, " ")
      .replace(/\*(.)/g, "");
  const body = literal(before) + numeric + literal(after);
  return treatAsNegative ? `-${body}` : body;
}

export function formatNumber(value: number, format: string | undefined): string {
  if (!Number.isFinite(value)) return "#NUM!";
  if (!format || format.toLowerCase() === "general") return generalNumber(value);

  const sections = splitSections(format);
  let section = sections[0];
  let negativeSign = false;
  if (value < 0) {
    if (sections.length >= 2) section = sections[1];
    else negativeSign = true;
  } else if (value === 0 && sections.length >= 3) {
    section = sections[2];
  }
  if (section.trim().toLowerCase() === "general" || section.trim() === "") return generalNumber(value);
  if (/^@$/.test(section.trim())) return generalNumber(value);
  return formatWithPattern(value, section, negativeSign);
}

// ---- dates ----------------------------------------------------------------

type DateToken = { kind: "field"; text: string } | { kind: "literal"; text: string };

function tokenizeDateFormat(section: string): DateToken[] {
  const tokens: DateToken[] = [];
  const pattern = /"([^"]*)"|\\(.)|\[[^\]]*\]|(yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P)|(.)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section))) {
    if (match[1] !== undefined) tokens.push({ kind: "literal", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: "literal", text: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: "field", text: match[3] });
    else if (match[4] !== undefined) tokens.push({ kind: "literal", text: match[4] });
    // [bracketed] modifiers (e.g. [h] elapsed time, colours) add nothing.
  }
  return tokens;
}

export function formatDate(date: Date, format: string | undefined): string {
  const fmt = format && isDateFormat(format) ? splitSections(format)[0] : "yyyy-mm-dd";
  const tokens = tokenizeDateFormat(fmt);
  const twelveHour = tokens.some((t) => t.kind === "field" && /^(am\/pm|a\/p)$/i.test(t.text));

  // "m" means minutes right after an hour field or right before seconds;
  // otherwise it's the month.
  const fieldIndexes = tokens.map((t, i) => (t.kind === "field" ? i : -1)).filter((i) => i >= 0);
  const isMinute = (tokenIndex: number) => {
    const pos = fieldIndexes.indexOf(tokenIndex);
    const prev = pos > 0 ? tokens[fieldIndexes[pos - 1]].text.toLowerCase() : "";
    const next = pos < fieldIndexes.length - 1 ? tokens[fieldIndexes[pos + 1]].text.toLowerCase() : "";
    return /^hh?$/.test(prev) || /^ss?$/.test(next);
  };

  // Excel serial dates are timezone-free; ExcelJS builds them as UTC.
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");

  return tokens
    .map((token, index) => {
      if (token.kind === "literal") return token.text;
      const t = token.text.toLowerCase();
      switch (t) {
        case "yyyy": return String(year);
        case "yy": return pad(year % 100);
        case "mmmm": return MONTHS[month];
        case "mmm": return MONTHS[month].slice(0, 3);
        case "mm": return isMinute(index) ? pad(minutes) : pad(month + 1);
        case "m": return isMinute(index) ? String(minutes) : String(month + 1);
        case "dddd": return DAYS[weekday];
        case "ddd": return DAYS[weekday].slice(0, 3);
        case "dd": return pad(day);
        case "d": return String(day);
        case "hh": return pad(twelveHour ? hours % 12 || 12 : hours);
        case "h": return String(twelveHour ? hours % 12 || 12 : hours);
        case "ss": return pad(seconds);
        case "s": return String(seconds);
        case "am/pm": return hours < 12 ? "AM" : "PM";
        case "a/p": return hours < 12 ? "A" : "P";
        default: return token.text;
      }
    })
    .join("");
}
