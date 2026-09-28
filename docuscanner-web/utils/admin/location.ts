// Shared coarse-location formatting, reused by both Live Admin views and
// the Ads targeting UI so the two stay visually and logically consistent --
// same underlying country_code/region fields, same display rules. Never
// handles precise coordinates or IP addresses; those never reach the client.

import iso3166 from "iso-3166-2";

const iso3166Country = iso3166.country;

// Converts a 2-letter ISO code into its flag emoji via Unicode Regional
// Indicator Symbols (each letter -> 0x1F1E6 + offset). No lookup table
// needed, and it's correct for every valid ISO 3166-1 alpha-2 code.
export function countryFlag(countryCode: string | null | undefined): string | null {
  if (!countryCode || countryCode.length !== 2) return null;
  const code = countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const points = [...code].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...points);
}

let countryDisplayNames: Intl.DisplayNames | null | undefined;
export function countryName(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  if (countryDisplayNames === undefined) {
    try {
      countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      countryDisplayNames = null;
    }
  }
  try {
    return countryDisplayNames?.of(countryCode.toUpperCase()) ?? countryCode.toUpperCase();
  } catch {
    return countryCode.toUpperCase();
  }
}

// Vercel's geolocation() returns the bare subdivision code (e.g. "CA", "LA",
// "ENG") in `countryRegion`, without the country prefix ISO 3166-2 itself
// uses ("US-CA") -- this is what's actually stored in region columns. Backed
// by the `iso-3166-2` dataset (~250KB, no runtime deps, covers every ISO
// 3166-1 country, not a hand-picked handful): "US"+"CA" -> "California",
// "NG"+"LA" -> "Lagos", "GB"+"ENG" -> "England". Falls back to the raw code
// -- never blank, never fabricated -- when the code isn't a recognized ISO
// 3166-2 subdivision (some geolocation providers return free-form names
// that already read fine as-is, e.g. non-ISO region strings).
export function regionName(countryCode: string | null | undefined, region: string | null | undefined): string | null {
  if (!region) return null;
  if (!countryCode) return region;
  try {
    const country = iso3166Country(countryCode.toUpperCase());
    const sub = country?.sub?.[`${countryCode.toUpperCase()}-${region.toUpperCase()}`];
    return sub?.name ?? region;
  } catch {
    return region;
  }
}

// "🇳🇬 Nigeria · Lagos State" / "🇳🇬 Nigeria" / "Location unavailable" -- the
// one place this two-level (no city) formatting rule lives; the Geography
// admin page's three-level City/Region/Country format is formatFullLocation
// below instead.
export function formatLocation(countryCode: string | null | undefined, region: string | null | undefined): string {
  if (!countryCode) return "Location unavailable";
  const flag = countryFlag(countryCode);
  const name = countryName(countryCode) ?? countryCode;
  const country = flag ? `${flag} ${name}` : name;
  const regionLabel = regionName(countryCode, region);
  return regionLabel ? `${country} · ${regionLabel}` : country;
}

// City, State/Region, Country -> State/Region, Country -> Country ->
// "Unknown" -- the one place this format lives, used throughout the admin
// (Geography's tables/summaries, the location-detail table) so a row's
// location always reads the same way. Region and country are always shown
// as their human name ("California", "Nigeria"), never a bare code, and a
// level that isn't present is dropped cleanly -- never an empty ", ,".
export function formatFullLocation(
  countryCode: string | null | undefined,
  region: string | null | undefined,
  city: string | null | undefined,
): string {
  if (!countryCode) return "Unknown";
  const country = countryName(countryCode) ?? countryCode;
  const regionLabel = regionName(countryCode, region);
  const parts = [city, regionLabel, country].filter((p): p is string => !!p);
  return parts.join(", ");
}
