// Reads a report/geography selection out of page search params
// (e.g. /admin/geography?country=..&state=..&city=..&lga=..&from=..&to=..).
// Uses the same parser as the export backend, so every accepted spelling
// (state/state_province/region, lga/county_district_lga, ...) means the same
// thing on every page.

import { parseFilters } from "../../supabase/functions/_shared/analyticsFilters.ts";
import { EMPTY_SELECTION, type Selection } from "./geoLevels.ts";
import { defaultDateRange } from "./dateRange.ts";
import type { DateRange } from "./types.ts";

export type SearchParams = Record<string, string | string[] | undefined>;

export function toURLSearchParams(input: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v) params.set(key, v);
  }
  return params;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function rangeFromParams(params: URLSearchParams, fallbackDays: number): DateRange {
  const from = params.get("from");
  const to = params.get("to");
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to) return { from, to };
  return defaultDateRange(fallbackDays);
}

export function selectionFromParams(params: URLSearchParams) {
  const f = parseFilters(params);
  const selection: Selection = {
    ...EMPTY_SELECTION,
    country: f.country,
    state_province: f.state_province,
    city_town: f.city_town,
    county_district_lga: f.county_district_lga,
    neighborhood_suburb: f.neighborhood_suburb,
  };
  return { selection, filters: f };
}
