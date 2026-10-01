// End-to-end through the real Next export route (production build) against tests/perf/mock-supabase.mjs:
// a month range, a one-day range, a filtered range, bad ranges, and CSV / XLSX / JSON agreeing with each other.
// The mock serves 12,000 events (400/day, Sep 1-30 2026) with the same paging protocol as the edge function.
//   node tests/perf/export-route.mjs <cookieFile> [base]
import assert from "node:assert/strict";
import fs from "node:fs";
import ExcelJS from "exceljs";

const cookie = fs.readFileSync(process.argv[2], "utf8").trim();
const BASE = (process.argv[3] ?? "http://localhost:3102").replace(/\/$/, "");
const MOCK = "http://127.0.0.1:54321";
let pass = 0, fail = 0;
const check = (name, ok, detail) => (ok ? pass++ : (fail++, console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`)));
const get = (qs) => fetch(`${BASE}/api/admin/analytics-export?${qs}`, { headers: { cookie: `sb-127-auth-token=${cookie}` } });

function parseCsv(text) {
  const t = text.replace(/^﻿/, "");
  const rows = [[""]];
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i], row = rows[rows.length - 1];
    if (q) { if (c === '"' && t[i + 1] === '"') { row[row.length - 1] += '"'; i++; } else if (c === '"') q = false; else row[row.length - 1] += c; }
    else if (c === '"') q = true; else if (c === ",") row.push(""); else if (c === "\n") rows.push([""]); else if (c !== "\r") row[row.length - 1] += c;
  }
  if (rows.at(-1).length === 1 && rows.at(-1)[0] === "") rows.pop();
  return rows;
}
const col = (rows, name) => rows.slice(1).map((r) => r[rows[0].indexOf(name)]);

await fetch(`${MOCK}/__reset`);
// 1. Month range as CSV (needs 3 pages of up to 5000 rows).
const month = await get("report_type=full&from=2026-09-01&to=2026-09-30&format=csv");
check("month: 200 + csv", month.status === 200 && /text\/csv/.test(month.headers.get("content-type")));
check("month: filename", /freepdfscanner-analytics-2026-09-01-to-2026-09-30\.csv/.test(month.headers.get("content-disposition") ?? ""), month.headers.get("content-disposition"));
const monthRows = parseCsv(await month.text());
const ids = col(monthRows, "record_id");
check("month: all 12,000 rows, no duplicates", ids.length === 12000 && new Set(ids).size === 12000, String(ids.length));
const pages = await (await fetch(`${MOCK}/__export_pages`)).json();
check("month: big pages (3 requests, not 12)", pages.length === 3 && pages[0].size === 5000, JSON.stringify(pages));
check("month: admin profile on every row even though later pages omit it", col(monthRows, "admin_user_id").every((v) => v === "u1"));
const days = col(monthRows, "occurred_at").map((t) => t.slice(0, 10));
check("month: nothing outside Sep 1-30", days.every((d) => d >= "2026-09-01" && d <= "2026-09-30") && days.includes("2026-09-01") && days.includes("2026-09-30"));

// 2. One day, 3. week, from CSV vs XLSX vs JSON.
for (const [label, from, to, expected] of [["one day", "2026-09-15", "2026-09-15", 400], ["7 days", "2026-09-01", "2026-09-07", 2800]]) {
  const qs = `report_type=full&from=${from}&to=${to}`;
  const csv = parseCsv(await (await get(`${qs}&format=csv`)).text());
  const json = await (await get(`${qs}&format=json`)).json();
  const xlsxBuf = Buffer.from(await (await get(`${qs}&format=xlsx`)).arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsxBuf);
  const sheet = wb.getWorksheet("Analytics export");
  const xlsxIds = [];
  const header = sheet.getRow(1).values.slice(1);
  sheet.eachRow((row, n) => { if (n > 1) xlsxIds.push(String(row.values[header.indexOf("record_id") + 1])); });
  const jsonIds = json.records.map((r) => String(r.record_id));
  const csvIds = col(csv, "record_id");
  check(`${label}: ${expected} rows in CSV, XLSX and JSON`, csvIds.length === expected && xlsxIds.length === expected && jsonIds.length === expected && json.record_count === expected, `${csvIds.length}/${xlsxIds.length}/${jsonIds.length}`);
  check(`${label}: same ids in the same order across formats`, JSON.stringify(csvIds) === JSON.stringify(xlsxIds) && JSON.stringify(csvIds) === JSON.stringify(jsonIds));
  check(`${label}: JSON states the exact range`, json.range?.from === from && json.range?.to === to);
  check(`${label}: all rows inside the range`, col(csv, "occurred_at").every((t) => t.slice(0, 10) >= from && t.slice(0, 10) <= to));
}
// 4. Filters respected.
const ng = parseCsv(await (await get("report_type=full&from=2026-09-01&to=2026-09-07&country=NG&format=csv")).text());
check("filter: only NG rows, half of the week", col(ng, "country_code").length === 1400 && col(ng, "country_code").every((c) => c === "NG"));
// 5. Empty range is a valid empty file; bad ranges are rejected, never defaulted.
const empty = parseCsv(await (await get("report_type=full&from=2031-01-01&to=2031-01-31&format=csv")).text());
check("empty range: header only", empty.length === 1 && empty[0].includes("record_id"));
for (const [label, qs] of [["start after end", "from=2026-09-07&to=2026-09-01"], ["cleared start", "from=&to=2026-09-07"], ["cleared end", "from=2026-09-01&to="], ["not a date", "from=abc&to=2026-09-07"], ["impossible date", "from=2026-02-30&to=2026-03-02"]]) {
  const res = await get(`report_type=full&${qs}&format=csv`);
  check(`${label}: rejected with 400`, res.status === 400, String(res.status));
}
// 6. Preview (summary) uses the same walk and reports the same count.
const summary = await (await get("report_type=full&from=2026-09-01&to=2026-09-30&format=summary")).json();
check("summary preview counts the same 12,000 records", summary.summary?.records === 12000 && summary.range?.from === "2026-09-01" && summary.range?.to === "2026-09-30", JSON.stringify(summary.summary));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
