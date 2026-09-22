// Country/region reference data for the Ads targeting picker. Countries use
// the full ISO 3166-1 list (via Intl.supportedValuesOf when available, so
// it's always complete and correct without a hand-maintained table) with a
// small hardcoded fallback for older runtimes. Regions are curated only for
// the countries explicitly needed -- Nigeria, Ghana, the UK, the US -- since
// "where the application has enough supported location data" was the
// explicit scope, not full world subdivision coverage. A country outside
// this curated set still works for country-level targeting; its region
// field just falls back to free text in the campaign form.

import { countryName } from "./location";

const FALLBACK_COUNTRY_CODES = [
  "US", "GB", "NG", "GH", "CA", "AU", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "DK", "FI",
  "IE", "PT", "BE", "CH", "AT", "PL", "CZ", "GR", "TR", "ZA", "KE", "EG", "MA", "IN", "PK",
  "BD", "ID", "PH", "VN", "TH", "MY", "SG", "JP", "KR", "CN", "HK", "TW", "BR", "MX", "AR",
  "CL", "CO", "PE", "AE", "SA", "QA", "IL", "NZ", "RU", "UA",
];

export interface CountryOption {
  code: string;
  name: string;
}

let cachedCountries: CountryOption[] | null = null;

export function getCountryOptions(): CountryOption[] {
  if (cachedCountries) return cachedCountries;
  let codes: string[] = FALLBACK_COUNTRY_CODES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("region");
    if (supported && supported.length > 0) {
      codes = supported.filter((c) => /^[A-Z]{2}$/.test(c));
    }
  } catch {
    // keep fallback list
  }
  cachedCountries = codes
    .map((code) => ({ code, name: countryName(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cachedCountries;
}

// Curated regions, only for countries where the product currently needs
// structured region targeting. Any other country uses free-text region
// entry in the campaign form.
export const REGIONS_BY_COUNTRY: Record<string, string[]> = {
  NG: [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Abuja/FCT", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
    "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
    "Taraba", "Yobe", "Zamfara",
  ],
  GH: [
    "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra",
    "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West",
    "Volta", "Western", "Western North",
  ],
  GB: ["England", "Scotland", "Wales", "Northern Ireland"],
  US: [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
    "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois",
    "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts",
    "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
    "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
    "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming",
  ],
};

export function getRegionsForCountries(countryCodes: string[]): string[] {
  const set = new Set<string>();
  for (const code of countryCodes) {
    for (const region of REGIONS_BY_COUNTRY[code.toUpperCase()] ?? []) set.add(region);
  }
  return [...set].sort();
}
