-- Global geographic analytics: extends the existing analytics/session model
-- rather than introducing a second one. country_code/region already existed
-- on live_sessions/ad_events, and country_code/region/city already existed
-- on analytics_events (all populated server-side from request geolocation,
-- never browser GPS). This migration adds the remaining fields needed for
-- full country -> region -> city -> postal_code coverage and provenance:
--
--   city / postal_code   -- added where missing (live_sessions, ad_events)
--   location_source      -- 'vercel' (country+region+city, most granular)
--                           or 'cloudflare' (country-only fallback), null
--                           for historical rows recorded before this change
--
-- No historical data is backfilled or fabricated -- existing rows simply
-- keep null/missing geography, which the admin UI already renders as
-- "Unknown". Purely additive; nothing here can break existing reads.

alter table public.analytics_events
  add column if not exists postal_code text,
  add column if not exists location_source text;

alter table public.live_sessions
  add column if not exists city text,
  add column if not exists postal_code text,
  add column if not exists location_source text;

alter table public.ad_events
  add column if not exists city text,
  add column if not exists postal_code text,
  add column if not exists location_source text;

comment on column public.analytics_events.location_source is
  'How country_code/region/city/postal_code were derived: vercel (platform geolocation, most granular) or cloudflare (country-only fallback). Null for rows recorded before this column existed.';
comment on column public.live_sessions.location_source is
  'Same meaning as analytics_events.location_source.';
comment on column public.ad_events.location_source is
  'Same meaning as analytics_events.location_source.';

-- Speeds up the admin geography table's per-country aggregation over a
-- date range (already the shape of admin-analytics' existing query).
create index if not exists analytics_events_country_created_at_idx
  on public.analytics_events (country_code, created_at);
create index if not exists ad_events_country_created_at_idx
  on public.ad_events (country_code, created_at);
