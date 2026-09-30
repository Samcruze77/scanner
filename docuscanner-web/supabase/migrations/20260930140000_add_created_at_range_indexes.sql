-- Admin dashboards and exports read analytics_events / ad_events by a bare date
-- range (created_at >= from AND created_at < to, then keyset on id). The existing
-- indexes all lead with country_code, region/city or visitor_id, so a range query
-- with no location filter -- the default view -- has no index that starts with
-- created_at. This adds exactly that; nothing else changes. `if not exists` makes
-- it safe if an equivalent index was added by hand in the project.
create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at);
create index if not exists ad_events_created_at_idx
  on public.ad_events (created_at);
