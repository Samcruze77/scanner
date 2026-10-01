-- Local stand-in for the production tables (columns + indexes copied from production's information_schema / pg_indexes).
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
exception when duplicate_object then null; end $$;
set timezone = 'UTC';
create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null, visitor_id text, session_id text, user_id uuid, path text, referrer text, ip_hash text,
  country_code text, region text, city text, device_type text, browser text, operating_system text,
  properties jsonb not null default '{}', created_at timestamptz not null default now(),
  postal_code text, location_source text, county_district_lga text, neighborhood_suburb text);
create table if not exists ad_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null, creative_id uuid not null, event_type text not null, slot_code text not null, user_id uuid,
  session_id text, device_type text, country_code text, created_at timestamptz not null default now(), path text,
  region text, city text, postal_code text, location_source text, county_district_lga text, neighborhood_suburb text);
create index if not exists analytics_events_country_created_at_idx on analytics_events (country_code, created_at);
create index if not exists analytics_events_country_created_idx on analytics_events (country_code, created_at desc);
create index if not exists analytics_events_created_idx on analytics_events (created_at desc);
create index if not exists analytics_events_event_created_idx on analytics_events (event_name, created_at desc);
create index if not exists analytics_events_geo_created_at_idx on analytics_events (country_code, region, city, created_at);
create index if not exists analytics_events_user_created_idx on analytics_events (user_id, created_at desc);
create index if not exists analytics_events_visitor_created_at_idx on analytics_events (visitor_id, created_at);
create index if not exists analytics_events_visitor_created_idx on analytics_events (visitor_id, created_at desc);
create index if not exists ad_events_created_idx on ad_events (created_at desc);
create index if not exists ad_events_geo_created_at_idx on ad_events (country_code, region, city, created_at);
create or replace function public.returning_visitor_ids(visitor_ids text[], before timestamptz)
returns table(visitor_id text) language sql stable set search_path to 'public' as $f$
  select distinct e.visitor_id from public.analytics_events e where e.visitor_id = any(visitor_ids) and e.created_at < before $f$;
