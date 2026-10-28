-- Administrator traffic is not visitor analytics.
--
-- The dashboard's SQL aggregation (admin_analytics_event_groups / admin_analytics_ad_groups)
-- now leaves out (a) events carrying an administrator's user_id and (b) events from a
-- browser (visitor_id) or session (session_id) that ever recorded a signed-in administrator,
-- which also removes the administrator's own pre-sign-in testing. "Administrator" = any row in
-- public.admin_users (every role, active or not).
--
-- Nothing is deleted or updated: rows stay in analytics_events / ad_events / live_sessions
-- and audit rows in admin_audit_logs are untouched. Reports simply do not count them.
-- Traffic whose browser never recorded a signed-in administrator cannot be linked and
-- stays in the figures (the account identity was never stored for it).
--
-- Same signatures, grants and return shapes as 20260930150000_admin_analytics_sql_aggregation.sql.

create or replace function public.admin_traffic_visitor_ids()
returns setof text
language sql
stable
set search_path = public
as $$
  select distinct e.visitor_id
  from public.analytics_events e
  where e.visitor_id is not null
    and e.user_id in (select user_id from public.admin_users)
$$;

create or replace function public.admin_analytics_event_groups(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  with admin_u as materialized (select user_id from public.admin_users),
  admin_v as materialized (select public.admin_traffic_visitor_ids() as visitor_id),
  admin_s as materialized (
    select distinct e2.session_id from public.analytics_events e2
    where e2.session_id is not null and e2.user_id in (select user_id from admin_u)
  ),
  win as (
    select e.* from public.analytics_events e
    where e.created_at >= p_from and e.created_at < p_to
      and (e.user_id is null or e.user_id not in (select user_id from admin_u))
      and (e.visitor_id is null or e.visitor_id not in (select visitor_id from admin_v))
      and (e.session_id is null or e.session_id not in (select session_id from admin_s))
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

-- Ad events: excluded when they carry an administrator's user_id, or belong to a session
-- in which an administrator was signed in (ad_events has no visitor_id, only session_id).
create or replace function public.admin_analytics_ad_groups(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  with admin_u as materialized (select user_id from public.admin_users),
  admin_s as materialized (
    select distinct e.session_id
    from public.analytics_events e
    where e.session_id is not null and e.user_id in (select user_id from admin_u)
  )
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
    select (a.created_at at time zone 'utc')::date as d, a.event_type, a.country_code, a.region, a.city,
           a.county_district_lga, a.neighborhood_suburb, a.device_type, count(*) as n
    from public.ad_events a
    where a.created_at >= p_from and a.created_at < p_to
      and (a.user_id is null or a.user_id not in (select user_id from admin_u))
      and (a.session_id is null or a.session_id not in (select session_id from admin_s))
    group by 1, 2, 3, 4, 5, 6, 7, 8
  ) g
$$;

revoke all on function public.admin_traffic_visitor_ids() from public, anon, authenticated;
revoke all on function public.admin_analytics_event_groups(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_analytics_ad_groups(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_traffic_visitor_ids() to service_role;
grant execute on function public.admin_analytics_event_groups(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_analytics_ad_groups(timestamptz, timestamptz) to service_role;
