// Unit tests for the five-level geography hierarchy: Country -> State /
// Province -> City / Town -> County / District / LGA -> Neighborhood /
// Suburb. Pure functions only (no network/browser/Deno).
//
// Run: node tests/analytics/geography-levels.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UNKNOWN, buildGeoHierarchy, buildLocationRows } from "../../supabase/functions/_shared/geoHierarchy.ts";
import { GEO_LEVELS, normalizeGeoLevels } from "../../supabase/functions/_shared/geoFields.ts";
import { EMPTY_SELECTION, buildTree, isSelectedNode, nodesUnder, selectNode } from "../../utils/admin/geoLevels.ts";
import { matchesFilters, parseFilters, resolveRange } from "../../supabase/functions/_shared/analyticsFilters.ts";

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

const ev = (o = {}) => ({
  event_name: "page_view",
  visitor_id: "v1",
  session_id: "s1",
  user_id: null,
  country_code: null,
  region: null,
  city: null,
  county_district_lga: null,
  neighborhood_suburb: null,
  device_type: "desktop",
  created_at: "2026-09-28T12:00:00.000Z",
  ...o,
});
const ad = (o = {}) => ({
  event_type: "impression",
  country_code: null,
  region: null,
  city: null,
  county_district_lga: null,
  neighborhood_suburb: null,
  device_type: "desktop",
  created_at: "2026-09-28T12:00:00.000Z",
  ...o,
});

// Synthetic place names only, so nothing here can be mistaken for seeded data.
const A = { country_code: "AA", region: "State-1", city: "Town-1", county_district_lga: "District-1", neighborhood_suburb: "Suburb-1" };
const B = { country_code: "BB", region: "Province-9", city: "Town-1", county_district_lga: "County-3", neighborhood_suburb: "Quarter-2" };

console.log("1. All five levels are defined, in order, with canonical names");
check(
  "levels",
  JSON.stringify(GEO_LEVELS.map((l) => l.field)) ===
    JSON.stringify(["country", "state_province", "city_town", "county_district_lga", "neighborhood_suburb"]),
);
check("reuses existing columns", GEO_LEVELS[1].column === "region" && GEO_LEVELS[2].column === "city");

console.log("2. Every level is represented and drillable");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", ...A }),
    ev({ visitor_id: "u2", session_id: "s2", ...B }),
    ev({ visitor_id: "u3", session_id: "s3", ...A, neighborhood_suburb: "Suburb-2" }),
  ];
  const h = buildGeoHierarchy(rows, [ad({ ...A })], 3, 3);
  check("2 countries", h.countries.length === 2);
  check("states", h.levels.state_province.length === 2);
  check("cities (same name, different parents => separate nodes)", h.levels.city_town.length === 2);
  check("counties", h.levels.county_district_lga.length === 2);
  check("neighborhoods", h.levels.neighborhood_suburb.length === 3);
  const aa = h.countries.find((c) => c.key === "AA");
  check("country rolls up child counts", aa.child_counts.state_province === 1 && aa.child_counts.city_town === 1 && aa.child_counts.county_district_lga === 1 && aa.child_counts.neighborhood_suburb === 2, JSON.stringify(aa.child_counts));
  const sub1 = h.levels.neighborhood_suburb.find((n) => n.key === "Suburb-1");
  check("node path carries every ancestor", sub1.path.country === "AA" && sub1.path.state_province === "State-1" && sub1.path.city_town === "Town-1" && sub1.path.county_district_lga === "District-1");
  check("ad metrics reach the deepest level", sub1.ad_impressions === 1);
  // Drill-down: children of AA -> State-1 -> Town-1 are only that path's values.
  const under = h.levels.county_district_lga.filter((n) => n.path.country === "AA" && n.path.state_province === "State-1" && n.path.city_town === "Town-1");
  check("drill-down only lists values that exist under the parent", under.length === 1 && under[0].key === "District-1");
}

console.log("3. Missing levels are null/absent, never fabricated");
{
  const rows = [ev({ country_code: "AA", region: "State-1" }), ev({ visitor_id: "u2", session_id: "s2", country_code: "AA", region: "State-1", neighborhood_suburb: "Suburb-1" })];
  const h = buildGeoHierarchy(rows, [], 2, 2);
  check("no city/county nodes invented", h.levels.city_town.length === 0 && h.levels.county_district_lga.length === 0);
  const sub = h.levels.neighborhood_suburb[0];
  check("neighborhood without city keeps null intermediate levels", sub.path.city_town === null && sub.path.county_district_lga === null);
  const unknown = buildGeoHierarchy([ev({ region: "State-1", city: "Town-1" })], [], 1, 1);
  check("no country => only Unknown country, never split further", unknown.countries[0].key === UNKNOWN && unknown.levels.state_province.length === 0);
}

console.log("4. Historical rows (columns absent/undefined) stay readable");
{
  const legacy = { event_name: "page_view", visitor_id: "v", session_id: "s", user_id: null, country_code: "AA", region: "State-1", city: "Town-1", device_type: "mobile", created_at: "2026-01-01T00:00:00Z" };
  const h = buildGeoHierarchy([legacy], [], 1, 1);
  check("legacy row counts at country/state/city", h.countries[0].users === 1 && h.levels.city_town.length === 1);
  const loc = buildLocationRows([legacy], [], new Set());
  check("location row has all five level fields (null where unknown)", loc[0].county_district_lga === null && loc[0].neighborhood_suburb === null && loc[0].state_province === "State-1" && loc[0].city_town === "Town-1");
}

console.log("5. Location detail rows keep the deepest levels apart");
{
  const rows = [ev({ session_id: "s1", ...A }), ev({ session_id: "s2", ...A, neighborhood_suburb: "Suburb-2" })];
  const loc = buildLocationRows(rows, [], new Set());
  check("two neighborhoods => two rows", loc.length === 2);
}

console.log("6. Provider terminology is normalized onto the canonical fields");
{
  const us = normalizeGeoLevels({ state: "State-1", town: "Town-1", county: "County-1", neighbourhood: "Quarter-1" });
  check("state/town/county/neighbourhood", us.state_province === "State-1" && us.city_town === "Town-1" && us.county_district_lga === "County-1" && us.neighborhood_suburb === "Quarter-1");
  const ng = normalizeGeoLevels({ province: "P", locality: "L", lga: "G", suburb: "S" });
  check("province/locality/lga/suburb", ng.state_province === "P" && ng.city_town === "L" && ng.county_district_lga === "G" && ng.neighborhood_suburb === "S");
  const canon = normalizeGeoLevels({ state_province: "X", city_town: "Y", county_district_lga: "Z", neighborhood_suburb: "W", region: "ignored" });
  check("canonical names win over aliases", canon.state_province === "X");
  const empty = normalizeGeoLevels({ city: "  ", region: 5 });
  check("blank/non-string => null", empty.city_town === null && empty.state_province === null);
  const nothing = normalizeGeoLevels(null);
  check("no provider data => all null", Object.values(nothing).every((v) => v === null));
}

console.log("7. Filters work at every level and match the dashboard semantics");
{
  const f = parseFilters(new URLSearchParams("country=aa&state_province=State-1&city_town=Town-1&county_district_lga=District-1&neighborhood_suburb=Suburb-1&device=desktop"));
  check("parsed", f.country === "AA" && f.neighborhood_suburb === "Suburb-1");
  check("match", matchesFilters({ ...A, device_type: "desktop" }, f));
  check("neighborhood mismatch", !matchesFilters({ ...A, neighborhood_suburb: "Suburb-2", device_type: "desktop" }, f));
  check("legacy row (no county) fails a county filter", !matchesFilters({ country_code: "AA", region: "State-1", city: "Town-1", device_type: "desktop" }, f));
  const legacyAlias = parseFilters(new URLSearchParams("region=State-1&city=Town-1"));
  check("legacy region/city aliases still accepted", legacyAlias.state_province === "State-1" && legacyAlias.city_town === "Town-1");
  const unk = parseFilters(new URLSearchParams("country=Unknown"));
  check("Unknown country filter matches null-country rows (case-insensitive)", matchesFilters({ country_code: null, region: null, city: null, device_type: null }, unk));
  check("no filters => everything matches", matchesFilters({ country_code: null, region: null, city: null, device_type: null }, parseFilters(new URLSearchParams())));
  check("bad visitor_type ignored", parseFilters(new URLSearchParams("visitor_type=x")).visitor_type === null);
  const range = resolveRange(new URLSearchParams("from=2026-09-01&to=2026-09-01"));
  check("single-day range includes the whole day", range.ok && range.toExclusive.getTime() - range.from.getTime() === 86_400_000);
  check("inverted range rejected", resolveRange(new URLSearchParams("from=2026-09-05&to=2026-09-01")).ok === false);
}

console.log("8. No hard-coded countries/regions/cities in the geography code");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = [
    "../../supabase/functions/_shared/geoFields.ts",
    "../../supabase/functions/_shared/geoHierarchy.ts",
    "../../supabase/functions/_shared/analyticsFilters.ts",
    "../../supabase/functions/_shared/exportRows.ts",
    "../../app/admin/geography/GeographyClient.tsx",
  ];
  const banned = /\b(Nigeria|Lagos|Ikeja|United States|California|San Francisco|SoMa)\b/;
  for (const f of files) {
    const src = fs.readFileSync(path.join(here, f), "utf8").replace(/\/\/.*$/gm, "");
    check(`no hard-coded place names in ${path.basename(f)}`, !banned.test(src));
  }
}

console.log("9. Same city name under different parents is never merged (full-path keys)");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", country_code: "AA", region: "State-1", city: "Town-A" }),
    ev({ visitor_id: "u2", session_id: "s2", country_code: "AA", region: "State-2", city: "Town-A" }),
    ev({ visitor_id: "u3", session_id: "s3", country_code: "AA", region: "State-2", city: "Town-A" }),
    ev({ visitor_id: "u4", session_id: "s4", country_code: "AA", region: "State-2", city: "Town-A", county_district_lga: "D-1" }),
    ev({ visitor_id: "u5", session_id: "s5", country_code: "AA", region: "State-2", city: "Town-A", county_district_lga: "D-2" }),
  ];
  const h = buildGeoHierarchy(rows, [], 5, 5);
  const towns = h.levels.city_town.filter((c) => c.key === "Town-A");
  check("two Town-A nodes, one per state", towns.length === 2);
  check("State-1 / Town-A has 1 user; State-2 / Town-A has 4", towns.find((t) => t.path.state_province === "State-1").users === 1 && towns.find((t) => t.path.state_province === "State-2").users === 4);
  check("legacy cities_by_country view keeps both", h.citiesByCountry.AA.filter((c) => c.key === "Town-A").length === 2);
  const s2 = h.levels.state_province.find((s) => s.key === "State-2");
  check("state rolls up its own city + districts only", s2.child_counts.city_town === 1 && s2.child_counts.county_district_lga === 2);
  const d = h.levels.county_district_lga;
  check("districts keyed under their own state/city path", d.length === 2 && d.every((n) => n.path.state_province === "State-2" && n.path.city_town === "Town-A"));
  // Full-path keys also separate counties/neighborhoods with identical names.
  const dup = buildGeoHierarchy(
    [
      ev({ session_id: "a", visitor_id: "a", country_code: "AA", region: "S1", city: "T1", county_district_lga: "Central", neighborhood_suburb: "North" }),
      ev({ session_id: "b", visitor_id: "b", country_code: "AA", region: "S1", city: "T2", county_district_lga: "Central", neighborhood_suburb: "North" }),
    ],
    [],
    2,
    2,
  );
  check("identical district + neighborhood under different cities stay separate", dup.levels.county_district_lga.length === 2 && dup.levels.neighborhood_suburb.length === 2);
}

console.log("10. Drill-down helpers and the hierarchy tree");
{
  const rows = [
    ev({ visitor_id: "u1", session_id: "s1", ...A }),
    ev({ visitor_id: "u2", session_id: "s2", ...A, neighborhood_suburb: "Suburb-2" }),
    ev({ visitor_id: "u3", session_id: "s3", country_code: "AA", region: "State-1", city: null, county_district_lga: "Orphan-District" }), // no city supplied
    ev({ visitor_id: "u4", session_id: "s4", ...B }),
  ];
  const h = buildGeoHierarchy(rows, [], 4, 4);
  const nodes = { country: h.countries, ...h.levels };
  let sel = selectNode(EMPTY_SELECTION, "city_town", h.levels.city_town.find((c) => c.path.country === "AA"));
  check("selecting a city pins its ancestors", sel.country === "AA" && sel.state_province === "State-1" && sel.city_town === "Town-1" && sel.county_district_lga === null);
  check("districts under the selection", nodesUnder(nodes, sel, "county_district_lga").map((n) => n.key).join() === "District-1");
  check("other country's districts are not offered", !nodesUnder(nodes, sel, "county_district_lga").some((n) => n.path.country === "BB"));
  sel = selectNode(sel, "state_province", null);
  check("clearing a level clears everything below it", sel.country === "AA" && sel.state_province === null && sel.city_town === null);
  check("isSelectedNode", isSelectedNode(selectNode(EMPTY_SELECTION, "country", h.countries[0]), "country", h.countries[0]));

  const tree = buildTree(nodes);
  const aa = tree.find((n) => n.row.key === "AA");
  check("country root with 4 users total in AA=3", aa.row.users === 3 && tree.length === 2);
  const state = aa.children[0];
  check("state child", state.field === "state_province" && state.row.key === "State-1");
  const town = state.children.find((n) => n.field === "city_town");
  check("city under state, districts under city, neighborhoods under district", town.children[0].field === "county_district_lga" && town.children[0].children.map((n) => n.row.key).sort().join() === "Suburb-1,Suburb-2");
  check("a district with no city attaches to its state, not to an invented city", state.children.some((n) => n.field === "county_district_lga" && n.row.key === "Orphan-District"));
  check("tree only contains nodes that exist", JSON.stringify(tree).includes("Orphan-District") && !JSON.stringify(tree).includes("Unknown"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
