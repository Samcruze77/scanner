// The five-level geography model as the admin UI uses it, shared by the
// Geography page, the Export page's filters and the hierarchy tree so all of
// them agree on levels, labels and selection semantics. Pure (no React).
// Nothing here names a country/state/city: values come only from the data.

import { countryName, regionName } from "./location.ts";
import type { AdminGeoChildField, AdminGeoField, AdminGeoRow } from "./types.ts";

export const LEVELS: { field: AdminGeoField; label: string; plural: string }[] = [
  { field: "country", label: "Country", plural: "countries" },
  { field: "state_province", label: "State / Province", plural: "states / provinces" },
  { field: "city_town", label: "City / Town", plural: "cities / towns" },
  { field: "county_district_lga", label: "County / District / LGA", plural: "counties / districts / LGAs" },
  { field: "neighborhood_suburb", label: "Neighborhood / Suburb", plural: "neighborhoods / suburbs" },
];
export const CHILD_LEVELS = LEVELS.slice(1) as { field: AdminGeoChildField; label: string; plural: string }[];

export type Selection = Record<AdminGeoField, string | null>;
export const EMPTY_SELECTION: Selection = {
  country: null,
  state_province: null,
  city_town: null,
  county_district_lga: null,
  neighborhood_suburb: null,
};

export type LevelNodes = Record<AdminGeoField, AdminGeoRow[]>;

// "Unknown" is an event with no country at all; a deeper level the provider
// did not supply is "Not available" -- the two are shown differently.
export const NOT_AVAILABLE = "Not available";

export function countryLabel(code: string): string {
  return code === "Unknown" ? "Unknown" : (countryName(code) ?? code);
}

export function nodeLabel(field: AdminGeoField, row: AdminGeoRow): string {
  if (field === "country") return countryLabel(row.key);
  if (field === "state_province") return regionName(row.path.country, row.key) ?? row.key;
  return row.key;
}

export function valueAt(row: AdminGeoRow, field: AdminGeoField): string | null {
  return field === "country" ? row.path.country : row.path[field];
}

export function levelIndex(field: AdminGeoField): number {
  return LEVELS.findIndex((l) => l.field === field);
}

// Nodes at a level that sit under every currently-selected ancestor
// (an unselected ancestor places no constraint).
export function nodesUnder(nodes: LevelNodes, selection: Selection, field: AdminGeoField): AdminGeoRow[] {
  const index = levelIndex(field);
  return nodes[field].filter((row) =>
    LEVELS.slice(0, index).every((a) => {
      const chosen = selection[a.field];
      return !chosen || valueAt(row, a.field) === chosen;
    }),
  );
}

// Selecting a node pins every ancestor from its own path and clears
// everything deeper; selecting null clears that level and below.
export function selectNode(prev: Selection, field: AdminGeoField, row: AdminGeoRow | null): Selection {
  const index = levelIndex(field);
  if (!row) {
    const next = { ...prev };
    for (const level of LEVELS.slice(index)) next[level.field] = null;
    return next;
  }
  const next: Selection = { ...EMPTY_SELECTION };
  for (const level of LEVELS.slice(0, index + 1)) next[level.field] = valueAt(row, level.field);
  return next;
}

export function isSelectedNode(selection: Selection, field: AdminGeoField, row: AdminGeoRow): boolean {
  if (selection[field] !== row.key) return false;
  return LEVELS.slice(0, levelIndex(field)).every((a) => !selection[a.field] || valueAt(row, a.field) === selection[a.field]);
}

// --- Hierarchy tree (Country -> ... -> Neighborhood) ---------------------

export interface TreeNode {
  field: AdminGeoField;
  row: AdminGeoRow;
  children: TreeNode[];
}

function pathId(row: AdminGeoRow, upTo: number): string {
  return LEVELS.slice(0, upTo + 1).map((l) => valueAt(row, l.field) ?? "").join("\u0001");
}

// Builds the nested tree from the flat per-level nodes. A place whose
// intermediate levels are missing (e.g. a district with no city) attaches to
// its nearest ancestor that exists -- never to an invented one. Only levels
// with data appear.
export function buildTree(nodes: LevelNodes): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const [index, level] of LEVELS.entries()) {
    for (const row of nodes[level.field]) {
      const node: TreeNode = { field: level.field, row, children: [] };
      byId.set(`${index}:${pathId(row, index)}`, node);
      let parent: TreeNode | undefined;
      for (let up = index - 1; up >= 0 && !parent; up--) {
        if (valueAt(row, LEVELS[up].field) !== null) parent = byId.get(`${up}:${pathId(row, up)}`);
      }
      (parent ? parent.children : roots).push(node);
    }
  }
  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) => b.row.users - a.row.users || a.row.key.localeCompare(b.row.key));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}
