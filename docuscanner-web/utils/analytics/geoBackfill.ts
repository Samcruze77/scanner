// Historical geography backfill -- planning logic (pure, unit tested).
//
// Historical analytics rows keep only what was recorded at the time: country,
// state/province, city, postal code, and a one-way HMAC of the IP (ip_hash).
// No raw IP address and no coordinates were ever stored, and an ip_hash cannot
// be reversed, so for almost every existing row there is NO source from which
// county/district/LGA or neighborhood/suburb could be legitimately derived.
// Those rows stay null; nothing is guessed.
//
// A row is a backfill candidate only when a configured resolver says it can
// resolve it from data the row really holds (for example a postal-code
// dataset supplied by an approved provider). With no resolver configured,
// every row is reported as "no usable source" and nothing changes.
// scripts/backfill-geography.mjs drives this against the database (dry run by
// default).

export interface HistoricalGeoRow {
  id: number;
  country_code: string | null;
  region: string | null;
  city: string | null;
  postal_code: string | null;
  county_district_lga: string | null;
  neighborhood_suburb: string | null;
}

export interface BackfillResolver {
  readonly name: string;
  // True only when the row holds enough real source data for this resolver.
  canResolve(row: HistoricalGeoRow): boolean;
  // Returns only values the resolver actually knows; anything else null.
  resolve(row: HistoricalGeoRow): Promise<{ county_district_lga: string | null; neighborhood_suburb: string | null } | null>;
}

export interface BackfillPlanItem {
  id: number;
  set: Partial<Pick<HistoricalGeoRow, "county_district_lga" | "neighborhood_suburb">>;
}

export interface BackfillReport {
  scanned: number;
  alreadyComplete: number;
  noUsableSource: number;
  unresolved: number;
  updates: BackfillPlanItem[];
}

const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() && !/^(-|n\/a|unknown|none|null)$/i.test(v.trim()) ? v.trim() : null);

// Existing values are never overwritten; a level the resolver can't supply
// stays null.
export async function planBackfill(rows: HistoricalGeoRow[], resolver: BackfillResolver | null): Promise<BackfillReport> {
  const report: BackfillReport = { scanned: rows.length, alreadyComplete: 0, noUsableSource: 0, unresolved: 0, updates: [] };
  for (const row of rows) {
    if (row.county_district_lga && row.neighborhood_suburb) {
      report.alreadyComplete += 1;
      continue;
    }
    if (!resolver || !row.country_code || !resolver.canResolve(row)) {
      report.noUsableSource += 1;
      continue;
    }
    const found = await resolver.resolve(row);
    const set: BackfillPlanItem["set"] = {};
    if (!row.county_district_lga && clean(found?.county_district_lga)) set.county_district_lga = clean(found?.county_district_lga);
    if (!row.neighborhood_suburb && clean(found?.neighborhood_suburb)) set.neighborhood_suburb = clean(found?.neighborhood_suburb);
    if (Object.keys(set).length === 0) report.unresolved += 1;
    else report.updates.push({ id: row.id, set });
  }
  return report;
}
