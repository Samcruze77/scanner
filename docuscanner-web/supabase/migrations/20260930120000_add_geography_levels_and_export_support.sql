-- Completes the geography hierarchy on the EXISTING analytics tables.
--
-- Canonical hierarchy (API / TypeScript / UI / export names) and the
-- physical column each maps to:
--   country              -> country_code            (already existed)
--   state_province       -> region                  (already existed)
--   city_town            -> city                    (already existed)
--   county_district_lga  -> county_district_lga     (added here)
--   neighborhood_suburb  -> neighborhood_suburb     (added here)
--
-- The current location provider (Vercel edge geolocation) only supplies
-- country/region/city/postal code, so the two new columns stay NULL until a
-- provider that returns them is wired in (the write path already accepts and
-- stores them). Nothing is backfilled or fabricated; historical rows keep
-- NULL, which every reader renders as Unknown/empty. Purely additive.

alter table public.analytics_events
  add column if not exists county_district_lga text,
  add column if not exists neighborhood_suburb text;

alter table public.live_sessions
  add column if not exists county_district_lga text,
  add column if not exists neighborhood_suburb text;

alter table public.ad_events
  add column if not exists county_district_lga text,
  add column if not exists neighborhood_suburb text;

comment on column public.analytics_events.county_district_lga is
  'County / district / local government area, normalized from the location provider. Null when the provider does not supply it.';
comment on column public.analytics_events.neighborhood_suburb is
  'Neighborhood / suburb, normalized from the location provider. Null when the provider does not supply it.';

comment on column public.analytics_events.location_source is
  'How country/state/city/district were derived: vercel (platform geolocation), cloudflare (country-only fallback), or vercel+<provider> when an optional IP provider filled in levels Vercel does not supply. Null for rows recorded before this column existed.';

-- Geography drill-down filters (country -> state -> city) over a date range.
create index if not exists analytics_events_geo_created_at_idx
  on public.analytics_events (country_code, region, city, created_at);
create index if not exists ad_events_geo_created_at_idx
  on public.ad_events (country_code, region, city, created_at);

-- New-vs-returning detection for the admin analytics/export functions: which
-- of the given visitors have any event before `before`. One indexed lookup
-- per chunk instead of pulling every prior event row through PostgREST's
-- row cap (which silently under-reported returning visitors).
create index if not exists analytics_events_visitor_created_at_idx
  on public.analytics_events (visitor_id, created_at);

create or replace function public.returning_visitor_ids(visitor_ids text[], before timestamptz)
returns table (visitor_id text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct e.visitor_id
  from public.analytics_events e
  where e.visitor_id = any(visitor_ids)
    and e.created_at < before
$$;

-- Admin-only data: callable solely by the Edge Functions' service-role client.
revoke all on function public.returning_visitor_ids(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.returning_visitor_ids(text[], timestamptz) to service_role;
