// Serialization for the admin analytics download: column set, headers and
// cell formatting shared by CSV, XLSX and JSON. Pure (no I/O), so it is unit
// tested directly (tests/analytics/export.mjs).
//
// The column set is derived from the shared export schema
// (supabase/functions/_shared/exportRows.ts) -- the one place that maps real
// database columns to export fields -- plus two display columns computed
// from the stored codes: `country` (name) and `state_province_name`.
// Headers ARE the canonical field names, so the same name appears in the
// database mapping, the API, the UI filters and the file.

import { PROFILE_FIELDS, RECORD_FIELDS, type AdminProfile, type ExportRecord } from "../../supabase/functions/_shared/exportRows.ts";
import { countryName, regionName } from "./location.ts";

export type Cell = string | number | boolean | null;

const EXPANDED_RECORD_FIELDS = RECORD_FIELDS.flatMap((field) => {
  if (field === "country_code") return ["country_code", "country"];
  if (field === "state_province") return ["state_province", "state_province_name"];
  return [field];
});

export const EXPORT_COLUMNS: readonly string[] = [...PROFILE_FIELDS, ...EXPANDED_RECORD_FIELDS];

export type FlatRow = Record<string, Cell>;

// One flat row: exporting admin's profile + the record + derived names.
// Absent values stay null (empty cell) -- nothing is defaulted or invented.
export function flattenRecord(record: ExportRecord, profile: AdminProfile): FlatRow {
  const code = record.country_code as string | null;
  const state = record.state_province as string | null;
  return {
    ...profile,
    ...record,
    country: code ? countryName(code) : null,
    state_province_name: state ? regionName(code, state) : null,
  };
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

export function csvLine(row: FlatRow): string {
  return EXPORT_COLUMNS.map((c) => csvCell(row[c])).join(",") + "\r\n";
}

export const CSV_HEADER = EXPORT_COLUMNS.join(",") + "\r\n";

// UTF-8 BOM so Excel opens non-ASCII place names correctly.
export const CSV_BOM = "﻿";

export function jsonRecord(row: FlatRow): FlatRow {
  // The admin profile is emitted once at the top level in JSON.
  const rest: FlatRow = {};
  for (const c of EXPORT_COLUMNS) if (!(PROFILE_FIELDS as readonly string[]).includes(c)) rest[c] = row[c] ?? null;
  return rest;
}

export function xlsxRow(row: FlatRow): Cell[] {
  return EXPORT_COLUMNS.map((c) => row[c] ?? null);
}

export function exportFilename(format: string, reportType: string, from: string, to: string): string {
  return `analytics-${reportType}-${from}_to_${to}.${format}`;
}
