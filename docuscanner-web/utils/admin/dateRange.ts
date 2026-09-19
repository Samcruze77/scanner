import type { DateRange } from "./types";

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function defaultDateRange(days = 7): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: toIsoDate(from), to: toIsoDate(to) };
}
