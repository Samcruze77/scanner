-- Total visits for the homepage visit counter.
--
-- A "visit" is one analytics session (session_id rotates after 30 minutes idle, see
-- utils/analytics/identity.ts). Administrator traffic is left out with the same rules as
-- the dashboard (20261028141446_exclude_admin_traffic_from_reports.sql). Only visitors who
-- consented to analytics are recorded, so this is a lower bound of real traffic.
--
-- Read-only, returns one number. Callable only with the server secret key (service_role);
-- the web app calls it from the server and caches the result.

create or replace function public.public_visit_count()
returns bigint
language sql
stable
set search_path = public
as $$
  with admin_u as materialized (select user_id from public.admin_users),
  admin_v as materialized (select public.admin_traffic_visitor_ids() as visitor_id),
  admin_s as materialized (
    select distinct e2.session_id from public.analytics_events e2
    where e2.session_id is not null and e2.user_id in (select user_id from admin_u)
  )
  select count(distinct e.session_id)
  from public.analytics_events e
  where e.session_id is not null
    and (e.user_id is null or e.user_id not in (select user_id from admin_u))
    and (e.visitor_id is null or e.visitor_id not in (select visitor_id from admin_v))
    and e.session_id not in (select session_id from admin_s)
$$;

revoke all on function public.public_visit_count() from public, anon, authenticated;
grant execute on function public.public_visit_count() to service_role;
