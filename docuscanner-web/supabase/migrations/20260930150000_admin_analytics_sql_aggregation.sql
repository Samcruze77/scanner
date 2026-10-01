-- Admin analytics used to read every event in the range through PostgREST, one
-- 1000-row keyset page at a time, then a separate call per 500 visitors for
-- new-vs-returning -- all from an Edge Function in a different region than the
-- database. Measured on production: the SQL for a 1000-row page runs in ~1.4 ms,
-- but each admin-analytics call took 1.5-3.3 s for 7 days and 7.5-12.4 s for 30
-- days, i.e. the time is sequential round trips, not query work.
--
-- These functions do the collapsing in the database and return it in ONE call:
--  * admin_analytics_event_groups / admin_analytics_ad_groups: one row per
--    distinct (day, event, visitor, session, user, location, device, browser, os,
--    referrer) with a count `n` (18,606 events -> 4,153 groups over 30 days on
--    production). Every figure the dashboard shows is derived from these rows
--    exactly as before (distinct ids are unaffected by collapsing; counts are sums
--    of n). New-vs-returning is resolved here (`returning`) with one indexed
--    lookup per distinct visitor.
--  * admin_export_events_page: one keyset page of export rows (up to 5000, not
--    capped by PostgREST's max-rows because it returns a single jsonb value) with
--    `is_returning` resolved in the same call.
-- Service role only, like returning_visitor_ids: callers go through the admin
-- Edge Functions, which check admin_users first. Existing indexes are used; no new
-- index is added (analytics_events_created_idx already exists in production).

create or replace function public.admin_analytics_event_groups(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  with win as (
    select * from public.analytics_events where created_at >= p_from and created_at < p_to
  ),
  returning_v as (
    select v.visitor_id
    from (select distinct visitor_id from win where visitor_id is not null) v
    where exists (
      select 1 from public.analytics_events p where p.visitor_id = v.visitor_id and p.created_at < p_from
    )
  ),
  grouped as (
    select (created_at at time zone 'utc')::date as d,
           event_name, visitor_id, session_id, user_id,
           country_code, region, city, county_district_lga, neighborhood_suburb, location_source,
           device_type, browser, operating_system, referrer,
           count(*) as n
    from win
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'created_at', g.d::text,
    'event_name', g.event_name,
    'visitor_id', g.visitor_id,
    'session_id', g.session_id,
    'user_id', g.user_id,
    'country_code', g.country_code,
    'region', g.region,
    'city', g.city,
    'county_district_lga', g.county_district_lga,
    'neighborhood_suburb', g.neighborhood_suburb,
    'location_source', g.location_source,
    'device_type', g.device_type,
    'browser', g.browser,
    'operating_system', g.operating_system,
    'referrer', g.referrer,
    'n', g.n,
    'returning', r.visitor_id is not null
  )), '[]'::jsonb)
  from grouped g
  left join returning_v r on r.visitor_id = g.visitor_id
$$;

create or replace function public.admin_analytics_ad_groups(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'created_at', g.d::text,
    'event_type', g.event_type,
    'country_code', g.country_code,
    'region', g.region,
    'city', g.city,
    'county_district_lga', g.county_district_lga,
    'neighborhood_suburb', g.neighborhood_suburb,
    'device_type', g.device_type,
    'n', g.n
  )), '[]'::jsonb)
  from (
    select (created_at at time zone 'utc')::date as d, event_type, country_code, region, city,
           county_district_lga, neighborhood_suburb, device_type, count(*) as n
    from public.ad_events
    where created_at >= p_from and created_at < p_to
    group by 1, 2, 3, 4, 5, 6, 7, 8
  ) g
$$;

-- plpgsql with only the predicates that were actually supplied: the catch-all
-- "(p is null or col = p)" form makes the planner estimate 1 row for the page,
-- which picked nested loops and made a 5000-row page take ~6 s instead of ~0.1 s
-- (measured locally, see tests/perf/sql).
create or replace function public.admin_export_events_page(
  p_from timestamptz,
  p_to timestamptz,
  p_after bigint,
  p_limit integer,
  p_event_names text[] default null,
  p_country text default null,
  p_region text default null,
  p_city text default null,
  p_district text default null,
  p_neighborhood text default null,
  p_device text default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  where_extra text := '';
  result jsonb;
begin
  if p_event_names is not null then where_extra := where_extra || format(' and e.event_name = any(%L::text[])', p_event_names); end if;
  if p_country is not null then where_extra := where_extra || format(' and e.country_code = %L', p_country); end if;
  if p_region is not null then where_extra := where_extra || format(' and e.region = %L', p_region); end if;
  if p_city is not null then where_extra := where_extra || format(' and e.city = %L', p_city); end if;
  if p_district is not null then where_extra := where_extra || format(' and e.county_district_lga = %L', p_district); end if;
  if p_neighborhood is not null then where_extra := where_extra || format(' and e.neighborhood_suburb = %L', p_neighborhood); end if;
  if p_device is not null then where_extra := where_extra || format(' and e.device_type = %L', p_device); end if;

  execute format($q$
    with page as materialized (
      select e.id, e.event_name, e.visitor_id, e.session_id, e.user_id, e.path, e.referrer,
             e.country_code, e.region, e.city, e.county_district_lga, e.neighborhood_suburb,
             e.postal_code, e.location_source, e.device_type, e.browser, e.operating_system,
             e.properties, e.created_at
      from public.analytics_events e
      where e.created_at >= $1 and e.created_at < $2 and e.id > $3 %s
      order by e.id
      limit least(greatest($4, 1), 5000)
    ),
    returning_v as materialized (
      select v.visitor_id
      from (select distinct visitor_id from page where visitor_id is not null) v
      where exists (select 1 from public.analytics_events p where p.visitor_id = v.visitor_id and p.created_at < $1)
    )
    select jsonb_build_object(
      'scanned', (select count(*) from page),
      'last_id', (select max(id) from page),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(pg) || jsonb_build_object('is_returning', r.visitor_id is not null) order by pg.id)
        from page pg left join returning_v r on r.visitor_id = pg.visitor_id
      ), '[]'::jsonb)
    )
  $q$, where_extra)
  into result
  using p_from, p_to, p_after, p_limit;
  return result;
end
$$;

revoke all on function public.admin_analytics_event_groups(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_analytics_ad_groups(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_export_events_page(timestamptz, timestamptz, bigint, integer, text[], text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_analytics_event_groups(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_analytics_ad_groups(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_export_events_page(timestamptz, timestamptz, bigint, integer, text[], text, text, text, text, text, text) to service_role;
