// Reference administrative units (state / LGA / FCT Area Council) as the admin
// Geography page browses them. Pure: no React, no I/O. The dataset itself lives in
// data/geo/ng-admin-units.json (OCHA COD-AB, CC BY-IGO) and mirrors the
// public.geo_admin_units table; see supabase/migrations/20261028120000_*.sql.
// These are reference places, not visitor locations -- an IP lookup does not
// resolve to an LGA.

export type AdminUnitType = "state" | "federal_capital_territory" | "lga" | "area_council";

export interface AdminUnitState {
  code: string;
  name: string;
  isoCode: string;
  type: "state" | "federal_capital_territory";
}

export interface AdminUnitLga {
  code: string;
  name: string;
  stateCode: string;
  type: "lga" | "area_council";
}

export interface AdminUnitsDataset {
  meta: { country: string; dataset: string; originalSource: string; url: string; retrieved: string; license: string };
  states: AdminUnitState[];
  lgas: AdminUnitLga[];
}

export const UNIT_TYPE_LABEL: Record<AdminUnitType, string> = {
  state: "State",
  federal_capital_territory: "Federal Capital Territory",
  lga: "Local Government Area",
  area_council: "Area Council",
};

export interface AdminUnitResult extends AdminUnitLga {
  stateName: string;
}

// LGAs/Area Councils of one state (or all when stateCode is empty) whose name
// contains the search text, alphabetical.
export function findUnits(data: AdminUnitsDataset, stateCode: string, search: string): AdminUnitResult[] {
  const q = search.trim().toLowerCase();
  const stateName = new Map(data.states.map((s) => [s.code, s.name]));
  return data.lgas
    .filter((l) => (!stateCode || l.stateCode === stateCode) && (!q || l.name.toLowerCase().includes(q)))
    .map((l) => ({ ...l, stateName: stateName.get(l.stateCode) ?? l.stateCode }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
