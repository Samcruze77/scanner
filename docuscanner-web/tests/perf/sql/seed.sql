-- Synthetic traffic shaped like production: visitors have a few sessions, sessions have many events that share
-- day/location/device/browser (production: 18,606 events -> 4,153 groups, 1,305 visitors, 1,473 sessions).
-- :sessions = number of sessions, :days = span.
truncate analytics_events restart identity; truncate ad_events restart identity;
create temp table sess as
select s, 'v' || (s * 7 / 10) as visitor_id, 's' || s as session_id,
       now() - ((s * 7919) % (:days * 86400)) * interval '1 second' as started,
       (s % 10) as k,
       (array['desktop','mobile','mobile','tablet'])[1 + (s % 4)] as device,
       (array['chrome','safari','firefox','edge'])[1 + (s % 4)] as browser,
       (array['windows','android','ios','macos'])[1 + ((s / 3) % 4)] as os,
       (array['https://google.com/','https://bing.com/',null])[1 + (s % 3)] as referrer
from generate_series(1, :sessions) s;
insert into analytics_events (event_name, visitor_id, session_id, country_code, region, city, postal_code, location_source, device_type, browser, operating_system, referrer, created_at, properties)
select (array['page_view','page_view','page_view','app_open','scan_started','scan_completed','document_downloaded','feature_used'])[1 + (e % 8)],
       s.visitor_id, s.session_id, c.cc, c.rg, c.ct, case when c.cc <> 'NG' then '12345' end, 'vercel',
       s.device, s.browser, s.os, s.referrer, s.started + (e * interval '7 seconds'),
       jsonb_build_object('tool', 'x' || (e % 17), 'note', 'padding padding padding padding')
from sess s
join (values (0,'NG','LA','Lagos'),(1,'NG','RI','Port Harcourt'),(2,'US','CA','San Jose'),(3,'US','TX','Austin'),(4,'IN','MH','Mumbai'),
             (5,'GB','ENG','London'),(6,'PH','00','Manila'),(7,'DE','BE','Berlin'),(8,'NG','LA','Lagos'),(9,'NG','LA','Lagos')) c(k,cc,rg,ct) on c.k = s.k
cross join generate_series(0, 11) e;
insert into ad_events (campaign_id, creative_id, event_type, slot_code, device_type, country_code, region, city, created_at)
select gen_random_uuid(), gen_random_uuid(), case when g % 25 = 0 then 'click' else 'impression' end, 'top', 'desktop', 'NG', 'LA', 'Lagos',
       now() - (g % (:days * 86400)) * interval '1 second'
from generate_series(1, :sessions) g;
analyze analytics_events; analyze ad_events;
