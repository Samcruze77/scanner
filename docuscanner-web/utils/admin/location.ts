// Shared coarse-location formatting, reused by both Live Admin views and
// the Ads targeting UI so the two stay visually and logically consistent --
// same underlying country_code/region fields, same display rules. Never
// handles precise coordinates or IP addresses; those never reach the client.

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

let regionNames: Intl.DisplayNames | null | undefined;
export function countryName(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(countryCode.toUpperCase()) ?? countryCode.toUpperCase();
  } catch {
    return countryCode.toUpperCase();
  }
}

// "🇳🇬 Nigeria · Lagos" / "🇳🇬 Nigeria" / "Location unavailable" -- the one
// place this formatting rule lives, per the "same location model everywhere"
// requirement.
export function formatLocation(countryCode: string | null | undefined, region: string | null | undefined): string {
  if (!countryCode) return "Location unavailable";
  const flag = countryFlag(countryCode);
  const name = countryName(countryCode) ?? countryCode;
  const country = flag ? `${flag} ${name}` : name;
  return region ? `${country} · ${region}` : country;
}
