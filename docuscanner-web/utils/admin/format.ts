// Defensive helpers for rendering the admin-analytics response without
// assuming exact field names inside overview/breakdowns/daily -- only the
// top-level response shape (role, range, overview, breakdowns, daily) is a
// verified part of the contract; what's inside each of those is not.

export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export interface OverviewEntry {
  key: string;
  label: string;
  value: number | null;
}

// overview is documented as present, but its internal keys aren't -- surface
// whatever numeric (or numeric-string) fields come back, keyed by name.
export function normalizeOverview(overview: unknown): OverviewEntry[] {
  if (!overview || typeof overview !== "object") return [];
  return Object.entries(overview as Record<string, unknown>).map(([key, raw]) => {
    const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return { key, label: humanizeKey(key), value: Number.isFinite(num) ? num : null };
  });
}

export interface BreakdownRow {
  label: string;
  value: number | null;
}

const LABEL_KEYS = ["label", "name", "key", "country", "region", "city", "device", "browser", "os", "referrer", "campaign", "source"];
const VALUE_KEYS = ["value", "count", "total", "visitors", "sessions"];

// Each breakdown's row shape isn't confirmed either -- try common label/value
// key names first, fall back to the first string/number field found.
export function normalizeBreakdownRow(row: unknown): BreakdownRow | null {
  if (row == null) return null;
  if (typeof row !== "object") {
    return { label: String(row), value: null };
  }
  const obj = row as Record<string, unknown>;

  let label: string | undefined;
  for (const k of LABEL_KEYS) {
    if (typeof obj[k] === "string") {
      label = obj[k] as string;
      break;
    }
  }
  let value: number | null = null;
  for (const k of VALUE_KEYS) {
    const raw = obj[k];
    const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(num)) {
      value = num;
      break;
    }
  }

  if (label === undefined) {
    const firstString = Object.values(obj).find((v) => typeof v === "string") as string | undefined;
    label = firstString ?? JSON.stringify(obj);
  }

  return { label, value };
}

export function normalizeBreakdown(rows: unknown): BreakdownRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeBreakdownRow).filter((r): r is BreakdownRow => r !== null);
}

// Columns for a raw daily table: the union of keys across all rows, in
// first-seen order, so any shape of {date, ...metrics} row renders sensibly.
export function dailyColumns(daily: unknown[] | undefined): string[] {
  if (!daily) return [];
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const row of daily) {
    if (row && typeof row === "object") {
      for (const key of Object.keys(row as Record<string, unknown>)) {
        if (!seen.has(key)) {
          seen.add(key);
          cols.push(key);
        }
      }
    }
  }
  return cols;
}

export interface DailyPoint {
  date: string;
  value: number;
}

const DATE_KEYS = ["date", "day", "period", "bucket"];

// Best-effort: if every daily row looks like { <date-ish key>: string,
// <one other numeric key>: number }, treat it as a single trend line.
// Anything less unambiguous (multiple numeric columns, no date-ish key)
// falls back to a raw table instead of guessing which field to chart.
export function tryDailySeries(daily: unknown[] | undefined): DailyPoint[] | null {
  if (!daily || daily.length === 0) return null;

  const cols = dailyColumns(daily);
  const dateKey = cols.find((c) => DATE_KEYS.includes(c.toLowerCase()));
  if (!dateKey) return null;

  const numericKeys = cols.filter((c) => {
    if (c === dateKey) return false;
    return daily.every((row) => {
      const v = row && typeof row === "object" ? (row as Record<string, unknown>)[c] : undefined;
      return v === undefined || typeof v === "number" || (typeof v === "string" && Number.isFinite(Number(v)));
    });
  });
  if (numericKeys.length !== 1) return null;

  const valueKey = numericKeys[0];
  return daily.map((row) => {
    const obj = (row ?? {}) as Record<string, unknown>;
    const rawValue = obj[valueKey];
    const value = typeof rawValue === "number" ? rawValue : Number(rawValue ?? 0);
    return { date: String(obj[dateKey] ?? ""), value: Number.isFinite(value) ? value : 0 };
  });
}

export function cellValue(row: unknown, column: string): string {
  if (!row || typeof row !== "object") return "";
  const value = (row as Record<string, unknown>)[column];
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
