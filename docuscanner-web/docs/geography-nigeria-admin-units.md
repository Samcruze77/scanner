# Nigerian administrative units (states, LGAs, FCT Area Councils)

## Source
- **Dataset:** Nigeria - Subnational Administrative Boundaries, OCHA COD-AB (`nga_admin_boundaries.xlsx`, sheets `nga_admin1`, `nga_admin2`) - https://data.humdata.org/dataset/cod-ab-nga
- **Original producers:** Office of the Surveyor General of the Federation of Nigeria (OSGOF), eHealth Africa, UN Cartographic Section.
- **Dataset last modified on HDX:** 2026-04-16 (boundaries valid on 2019-04-17). **Retrieved:** 2026-10-28.
- **Licence:** CC BY-IGO 3.0 - credit the producers above and OCHA HDX (shown on the admin page).
- **Known caveat from the publisher:** Bakassi (NG009005) is not in the population data; it is not a separate row here beyond the source's own admin-2 list.

## Contents (verified by `npm run test:geo`)
37 level-1 units (36 states + FCT) and 774 level-2 units: 768 LGAs + 6 FCT Area Councils (Abaji, Abuja Municipal, Bwari, Gwagwalada, Kuje, Kwali). Per-state counts are checked against independently typed published figures, plus parent, code-prefix, duplicate and spelling checks. Names are the source's spellings (e.g. `Port-Harcourt`).

## Files
- `data/geo/ng-admin-units.json` - the dataset (used by the admin Geography page).
- `supabase/migrations/20261028105309_create_geo_admin_units.sql` - table `public.geo_admin_units` (additive, RLS on, no policies: service role only).
- `supabase/seed/ng_admin_units.sql` - idempotent upsert on `(country_code, code)`; never deletes.
- `scripts/build-ng-admin-units.mjs <xlsx>` - regenerates the JSON and the seed from the workbook.

## Status
Applied to Supabase project `zdegimgixjpirtivrrgc` on 2026-10-28 (811 rows; content checksum equals the JSON). Remote migration history records it as `20261028105309_create_geo_admin_units`; the local file carries the same version. The live table was compared with the migration (columns, constraints, indexes, no policies, no anon/authenticated grants) and matches.

Older local migrations use different timestamps than the remote history for the same changes (e.g. local `20260930120000` vs remote `20260930105745`); that predates this work and was left untouched.

**Source of truth:** `data/geo/ng-admin-units.json` is canonical and is what the admin page reads (read-only reference data, no query, no credentials in the browser). The table is a SQL-side mirror for joins; `npm run test:geo` pins the JSON, and the seed is generated from it, so they cannot drift without a test failing.

## What this is not
These are reference places. Visitor location comes from the IP address (country / state / city) and is approximate; an LGA existing here does not mean a visitor can be placed in it. `analytics_events.county_district_lga` stays NULL unless a provider supplies it.
