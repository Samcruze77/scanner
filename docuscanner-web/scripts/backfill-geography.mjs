// Optional historical geography backfill: county/district/LGA and
// neighborhood/suburb for rows recorded before those levels existed.
//
// Read utils/analytics/geoBackfill.ts first: historical rows hold no raw IP and
// no coordinates, so unless you supply a resolver that can work from data the
// rows really contain, this reports "no usable source" and changes nothing.
//
//   node scripts/backfill-geography.mjs                       # dry run, report only
//   GEO_BACKFILL_RESOLVER=./my-resolver.mjs node scripts/backfill-geography.mjs --apply
//
// A resolver module default-exports { name, canResolve(row), resolve(row) }.
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY (server-side secret; never commit).

import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { planBackfill } from "../utils/analytics/geoBackfill.ts";

const apply = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

let resolver = null;
if (process.env.GEO_BACKFILL_RESOLVER) {
  resolver = (await import(pathToFileURL(path.resolve(process.env.GEO_BACKFILL_RESOLVER)).href)).default;
}

const PAGE = 1000;
const totals = { scanned: 0, alreadyComplete: 0, noUsableSource: 0, unresolved: 0, updated: 0 };

for (const table of ["analytics_events", "ad_events"]) {
  let after = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("id,country_code,region,city,postal_code,county_district_lga,neighborhood_suburb")
      .gt("id", after)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    if (!data.length) break;
    const report = await planBackfill(data, resolver);
    for (const k of ["scanned", "alreadyComplete", "noUsableSource", "unresolved"]) totals[k] += report[k];
    if (apply) {
      for (const u of report.updates) {
        // Only rows whose target columns are still null -- never overwrite.
        let q = supabase.from(table).update(u.set).eq("id", u.id);
        for (const col of Object.keys(u.set)) q = q.is(col, null);
        const { error: upErr } = await q;
        if (upErr) throw upErr;
        totals.updated += 1;
      }
    } else {
      totals.updated += report.updates.length; // would update
    }
    after = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  console.log(`${table}: done`);
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", resolver: resolver?.name ?? "none", ...totals }, null, 2));
if (!resolver) console.log("No resolver configured: rows have no usable source for county/district or neighborhood, so nothing is changed.");
