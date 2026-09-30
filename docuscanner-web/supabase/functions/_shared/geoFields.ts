// The one definition of the five-level geography hierarchy, shared by the
// Edge Functions (Deno) and tested directly by Node -- no runtime
// dependencies. Canonical names are used in API responses, TypeScript, the
// admin UI and exports; `column` is the physical column on analytics_events /
// ad_events / live_sessions (country_code, region and city predate the
// canonical names and are reused rather than duplicated).
//
// Nothing here names a country, state or city: levels are structural, values
// come only from whatever the location provider actually returned.

export const GEO_LEVELS = [
  { field: "country", column: "country_code", label: "Country" },
  { field: "state_province", column: "region", label: "State / Province" },
  { field: "city_town", column: "city", label: "City / Town" },
  { field: "county_district_lga", column: "county_district_lga", label: "County / District / LGA" },
  { field: "neighborhood_suburb", column: "neighborhood_suburb", label: "Neighborhood / Suburb" },
] as const;

export type GeoField = (typeof GEO_LEVELS)[number]["field"];
export type GeoColumn = (typeof GEO_LEVELS)[number]["column"];

// Providers name the same administrative level differently. Aliases are
// tried in order; the first non-empty one wins.
const ALIASES: Record<Exclude<GeoField, "country">, string[]> = {
  state_province: ["state_province", "region", "state", "province", "countryRegion", "country_region"],
  city_town: ["city_town", "city", "town", "locality"],
  county_district_lga: ["county_district_lga", "county", "district", "lga", "local_government_area", "admin_area_2"],
  neighborhood_suburb: ["neighborhood_suburb", "neighborhood", "neighbourhood", "suburb", "sublocality", "quarter"],
};

const MAX_LEN = 160;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_LEN) : null;
}

export interface NormalizedGeoLevels {
  state_province: string | null;
  city_town: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
}

// Maps whatever terminology a provider used onto the canonical levels.
// Missing levels are null -- never inferred from another level.
export function normalizeGeoLevels(input: Record<string, unknown> | null | undefined): NormalizedGeoLevels {
  const pick = (field: keyof NormalizedGeoLevels): string | null => {
    for (const alias of ALIASES[field]) {
      const value = clean(input?.[alias]);
      if (value) return value;
    }
    return null;
  };
  return {
    state_province: pick("state_province"),
    city_town: pick("city_town"),
    county_district_lga: pick("county_district_lga"),
    neighborhood_suburb: pick("neighborhood_suburb"),
  };
}
