# Administrator traffic and session duration

## Administrators are not visitors
"Administrator" = any row in `public.admin_users` (super_admin, admin, analyst; active or not). No email address is hard-coded and the browser is never trusted.

| Where | What happens |
|---|---|
| Ingestion (Edge Functions `track-analytics`, `heartbeat`, `track-ad-event`) | The proxy passes the user id from the verified session cookie; the function looks it up in `admin_users` (`_shared/adminTraffic.ts`, cached 60 s) and drops the event/presence/ad event (HTTP 202, `excluded: "admin"`). A client-supplied role/flag is never read. |
| Reports (`admin-analytics`, `admin-analytics-export`, `admin-live`, `admin-ads`) | Rows are left out when `user_id` is an administrator **or** the row's browser (`visitor_id`) also recorded a signed-in administrator (removes their pre-sign-in testing). The dashboard's SQL aggregation does the same in SQL (migration `20261029090000_exclude_admin_traffic_from_reports.sql`). |
| Browser (`utils/analytics/audience.ts`, `AudienceProvider`, `/api/analytics/audience`) | After the auth state is known the server says whether the signed-in user is an administrator. Until then nothing is sent; administrators send nothing and never load Clarity, on any page. If the check fails, events still go to the server (which excludes them) but Clarity stays off. |

Nothing is deleted or rewritten, and `admin_audit_logs` is untouched.

### Historical data
Only traffic that carries an administrator's `user_id`, or comes from a browser that also recorded a signed-in administrator, can be attributed. Guest visits from a browser that never recorded a signed-in administrator, and anything before accounts were attached, cannot be (the identity was never stored).

### Deploying (nothing here is deployed yet)
1. Apply the migration (reports exclude administrators in SQL).
2. Deploy the Edge Functions `track-analytics`, `heartbeat`, `track-ad-event`, `admin-analytics`, `admin-analytics-export`, `admin-live`, `admin-ads` (each imports `_shared/adminTraffic.ts`).
3. Push the website (audience probe, Clarity gating, session semantics).

### Clarity (outside this repository)
The site never starts Clarity for a verified administrator. Not covered: an administrator who is signed out, or whose role check cannot complete. Optional account setting for a fixed IPv4 address: Clarity project -> Settings -> IP blocking -> Block IP address (IPv4 only, no VPN/dynamic IPs, ~15 minutes to apply). This has not been changed from here.

## Session duration
- Session = one `live_sessions` row (one `session_id`). The browser starts a new `session_id` after 30 minutes without **user activity**; background heartbeats no longer count as activity (`peekSessionId`), so an idle visible tab no longer stays one session forever.
- Length = `last_seen - started_at`, validated (`utils/analytics/sessionDuration.ts`): missing/invalid -> "Unknown", up to 10 s of clock skew -> 0, no cap (a 4-day genuine session shows as 4 days). New presence rows stamp `started_at` and `last_seen` together.
- The "72 hours" the owner saw is **not a session duration**: it is Microsoft Clarity's Data Export API limit (`numOfDays` 1-3 = last 24/48/72 hours). It appears in Admin -> Exports -> Clarity ("Last 72 hours"). Longest real session in `live_sessions` on 2026-10-28: 5 h 35 m; none over 24 h.
