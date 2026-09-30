// Serialization for the admin analytics download: column sets, headers and
// cell formatting shared by CSV, XLSX and JSON, for both the raw record
// export and the aggregated Geography report. Pure (no I/O), unit tested in
// tests/analytics/export.mjs.
//
// Column sets are derived, not hand-listed: the admin-profile columns are
// whatever the exporting admin's real profile rows contain (see
// supabase/functions/_shared/adminProfile.ts), and the record columns come
// from the shared export schema (supabase/functions/_shared/exportRows.ts).
// Headers ARE the canonical field names, so the same name appears in the
// database mapping, the API, the UI filters and the file. `country` (name)
// and `state_province_name` are display columns computed from stored codes.

import { RECORD_FIELDS, type ExportRecord } from "../../supabase/functions/_shared/exportRows.ts";
import { profileColumns, type AdminProfileRecord } from "../../supabase/functions/_shared/adminProfile.ts";
import { countryName, regionName } from "./location.ts";
import { GEO_REPORT_FIELDS, type GeoReportRow } from "./geoReport.ts";

export type Cell = string | number | boolean | null;
export type FlatRow = Record<string, Cell>;

export const RECORD_COLUMNS: readonly string[] = RECORD_FIELDS.flatMap((field) => {
  if (field === "country_code") return ["country_code", "country"];
  if (field === "state_province") return ["state_province", "state_province_name"];
  return [field];
});

export const GEO_REPORT_COLUMNS: readonly string[] = GEO_REPORT_FIELDS;

// Profile columns first (in the deterministic order the profile was built
// in), then the report's own columns.
export function exportColumns(profile: AdminProfileRecord, kind: "records" | "geography"): string[] {
  return [...profileColumns(profile), ...(kind === "records" ? RECORD_COLUMNS : GEO_REPORT_COLUMNS)];
}

function names(code: string | null, state: string | null) {
  return {
    country: code ? countryName(code) : null,
    state_province_name: state ? regionName(code, state) : null,
  };
}

// One flat raw row: exporting admin's profile + the record + derived names.
// Absent values stay null (empty cell) -- nothing is defaulted or invented.
export function flattenRecord(record: ExportRecord, profile: AdminProfileRecord): FlatRow {
  return {
    ...profile,
    ...record,
    ...names(record.country_code as string | null, record.state_province as string | null),
  };
}

export function flattenGeoRow(row: GeoReportRow, profile: AdminProfileRecord): FlatRow {
  return { ...profile, ...row, ...names(row.country_code as string | null, row.state_province as string | null) };
}

// Spreadsheet apps execute cells beginning with = + - @ (or tab/CR) as
// formulas. Path/referrer/property values are visitor-controlled, so such
// text is prefixed with an apostrophe in CSV. Numbers are never touched.
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: Cell | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? neutralizeFormula(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvHeader(columns: readonly string[]): string {
  return columns.join(",") + "\r\n";
}

export function csvLine(row: FlatRow, columns: readonly string[]): string {
  return columns.map((c) => csvCell(row[c])).join(",") + "\r\n";
}

// UTF-8 BOM so Excel opens non-ASCII place names correctly.
export const CSV_BOM = "﻿";

// JSON emits the admin profile once at the top level, so per-record objects
// omit the profile columns.
export function jsonRecord(row: FlatRow, columns: readonly string[], profile: AdminProfileRecord): FlatRow {
  const rest: FlatRow = {};
  for (const c of columns) if (!(c in profile)) rest[c] = row[c] ?? null;
  return rest;
}

export function xlsxRow(row: FlatRow, columns: readonly string[]): Cell[] {
  return columns.map((c) => row[c] ?? null);
}

export function exportFilename(format: string, reportType: string, from: string, to: string): string {
  return `analytics-${reportType}-${from}_to_${to}.${format}`;
}
