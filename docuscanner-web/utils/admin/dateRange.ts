import type { DateRange } from "./types";

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// All admin date ranges are UTC calendar days and both ends are inclusive:
// 2026-09-01 .. 2026-09-07 covers 2026-09-01T00:00:00Z up to (not including)
// 2026-09-08T00:00:00Z. Stored events carry UTC timestamps, so this is the
// only definition that matches what is in the database exactly.
export const RANGE_TIMEZONE_LABEL = "UTC";

export function defaultDateRange(days = 7, now: Date = new Date()): DateRange {
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: toIsoDate(from), to: toIsoDate(now) };
}

export function todayRange(now: Date = new Date()): DateRange {
  const today = toIsoDate(now);
  return { from: today, to: today };
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === value;
}

// null when the range can be applied, otherwise the message to show.
export function validateRange(range: DateRange): string | null {
  if (!range.from) return "Choose a start date.";
  if (!range.to) return "Choose an end date.";
  if (!isIsoDay(range.from)) return "The start date is not a valid date.";
  if (!isIsoDay(range.to)) return "The end date is not a valid date.";
  if (range.from > range.to) return "The start date must be on or before the end date.";
  return null;
}

// Number of calendar days covered (both ends inclusive); 1 for a one-day range.
export function rangeDays(range: DateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
}
