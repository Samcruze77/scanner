# Administrator traffic and session duration

## Administrators are not visitors
"Administrator" = any row in `public.admin_users` (super_admin, admin, analyst; active or not). No email address is hard-coded and the browser is never trusted.

| Where | What happens |
|---|---|
| Ingestion (Edge Functions `track-analytics`, `heartbeat`, `track-ad-event`) | The proxy passes the user id from the verified session cookie; the function looks it up in `admin_users` (`_shared/adminTraffic.ts`, cached 60 s) and drops the event/presence/ad event (HTTP 202, `excluded: "admin"`). A client-supplied role/flag is never read. |
| Reports (`admin-analytics`, `admin-analytics-export`, `admin-live`, `admin-ads`) | Rows are left out when `user_id` is an administrator **or** the row's browser (`visitor_id`) also recorded a signed-in administrator (removes their pre-sign-in testing). The dashboard's SQL aggregation does the same in SQL (migration `20261028141446_exclude_admin_traffic_from_reports.sql`). |
| Browser (`utils/analytics/audience.ts`, `AudienceProvider`, `/api/analytics/audience`) | After the auth state is known the server says whether the signed-in account is a row in `admin_users` (ANY row: active or deactivated, same policy as ingestion/reporting; the route reads the table with the server-side secret key for one exact `user_id`, from the verified session). Until then nothing is sent. Administrators send nothing and never load Clarity, on any page. If the check cannot be completed (HTTP 503) Clarity stays off; first-party events are still sent and decided on the server. |

Nothing is deleted or rewritten, and `admin_audit_logs` is untouched.

### Historical data: how it is matched, and what it can wrongly exclude
Three links, the same in code (`_shared/adminTraffic.ts`) and SQL (migration `20261028141446`):
1. `user_id` is an administrator's account id (events, live sessions, ad events).
2. `visitor_id` equals one that ALSO appeared on an event with an administrator's `user_id`. `visitor_id` is a random id kept in that browser profile's `localStorage` (created only after analytics consent); it is not an IP address, fingerprint or cookie shared between browsers. So this removes the administrator's own pre-sign-in testing from that browser.
3. `session_id` equals one that appeared on an event with an administrator's `user_id` (the only link available for ad events, which have no visitor id).

Measured read-only on production, 2026-10-28 (1 administrator account):

| | rows with the admin's `user_id` | extra rows from the same browsers/sessions | excluded in total | of all rows |
|---|---|---|---|---|
| `analytics_events` | 597 | 1,206 (6 browsers, 75 sessions) | **1,803** | 27,116 |
| `live_sessions` | 48 | 140 | **188** | 1,035 |
| `ad_events` | 0 | 0 | 0 | 2 |

So "597 events / 48 sessions" is only the account-id part; the browser/session links add the administrator's signed-out testing. Checks on those 6 browsers: no other account ever signed in on them (0 rows with a non-admin `user_id`), no browser has more than one account, and each has only 2 to 32 active days of the administrator's own devices (desktop Chrome on Windows, Safari on macOS and iPhone, and some events whose user agent was not recognised).

**Could unrelated guest activity be excluded?** Only if another person used the administrator's browser profile (same `localStorage`) - e.g. a shared computer, or someone handed the administrator's phone. That cannot be detected from the data, and nothing in the data suggests it (every excluded unsigned row comes from one of those 6 browsers, none of which has a second account). A guest on a different browser or device, even in the same office or behind the same IP, is never matched: IP addresses are not used for this. The reverse also holds: administrator testing from a browser that never recorded a signed-in administrator, or after clearing site data (new `visitor_id`), cannot be attributed and stays in the figures.

Nothing is deleted, updated or backfilled: the exclusion is applied when reports are built, so it can be switched off by removing the migration/functions.

### Failure behaviour (an unknown answer is never "not an administrator")
**Ingestion** (`track-analytics`, `heartbeat`, `track-ad-event`) uses `checkAdminUser()` (`_shared/adminTraffic.ts`), which answers `admin`, `not_admin` or `unknown`:
- Guests have no account: always `not_admin`, no lookup, always tracked, even during an outage.
- Signed-in callers: a verified answer is cached 60 s. If the lookup then fails (timeout after 2.5 s, rejected query, thrown error, malformed or missing response, a row for someone else), a previously VERIFIED answer for that account up to 10 minutes old is reused (a verified administrator stays excluded, a verified customer stays tracked); otherwise the answer is `unknown`.
- `unknown` -> the event is **not stored** and the function answers HTTP 503 (the proxy logs the rejected status, monitoring sees it). One operational error is logged per 30 s per instance, with no user id, visitor/session id, path or other event content.
- Trade-off: while the `admin_users` lookup is down, events from signed-in visitors whose status was never verified on that instance in the last 10 minutes are lost. Guests are unaffected. Lost events are not replayed.
- Audit logs and admin activity logs are not involved and keep working.

**Reports** (dashboard fallback path, export, live view, campaign stats) call `loadAdminTraffic()`, which throws if it cannot read every administrator account, their browsers/sessions completely (paged), or gets a malformed or incomplete answer. The endpoint then answers HTTP 503 with only an error, never figures that still contain administrators. The dashboard's SQL fast path excludes inside SQL (migration `20261028141446`); if the SQL function fails the handler falls back to the raw-table path, which is subject to the same rule.

**Browser** (`/api/analytics/audience`): the answer is only `{excluded: true|false}` or 503. 503 covers a malformed identity, a failed/timed-out/malformed lookup and a thrown error. The browser waits for the answer before sending anything or loading Clarity, and keeps Clarity off on 503.

Reports and ingestion use the same three links (account, browser `visitor_id`, session `session_id`) and the same population (every `admin_users` row). Not changed by this work: `admin_audit_logs`, the admin Edge Functions' own authorization (which still requires an active administrator to view admin data).

### Migration workflow
Remote migration versions are the time the change was applied (for example `20261028105309_create_geo_admin_units`), and several older local files carry different stamps for the same change, so local filenames are not a reliable pairing key. The local file is stamped with a current (not future) time, after every remote version. Sequence: (1) apply with the Supabase migration tool (it records its own version); (2) read the version it recorded (`list_migrations`); (3) rename the local file to that version and update the references (as was done for `geo_admin_units`); never edit remote history by hand.

### Safe production rollout order (none of it done yet)
1. Apply the migration `20261028141446_exclude_admin_traffic_from_reports.sql` with the migration tool (additive: one new function, two replaced functions with unchanged signatures/grants; no table change). Read the version it records with `list_migrations` and rename the local file to match.
2. Deploy all seven Edge Functions: `track-analytics`, `heartbeat`, `track-ad-event`, `admin-analytics`, `admin-analytics-export`, `admin-live`, `admin-ads` (each imports `_shared/adminTraffic.ts`; deploy `_shared` with every one). `SUPABASE_SECRET_KEY` is already set in Vercel for the proxies and is what the audience route uses.
3. Push the website (audience route, browser gating, Clarity, session semantics).
4. Verify live: an administrator (including a deactivated one, if available) produces no event, presence row or Clarity request; a guest and a customer do; the dashboard figures exclude administrators; check function logs for `admin exclusion lookup failed`.
Rolling back: redeploying the previous function versions restores the previous behaviour; the migration only changes report queries and can be superseded.

### Clarity (outside this repository)
The site never starts Clarity for a verified administrator. Not covered: an administrator who is signed out, or whose role check cannot complete. Optional account setting for a fixed IPv4 address: Clarity project -> Settings -> IP blocking -> Block IP address (IPv4 only, no VPN/dynamic IPs, ~15 minutes to apply). This has not been changed from here.

## Session duration
- Session = one `live_sessions` row (one `session_id`). The browser starts a new `session_id` after 30 minutes without **user activity**; background heartbeats no longer count as activity (`peekSessionId`), so an idle visible tab no longer stays one session forever.
- Length = `last_seen - started_at`, validated (`utils/analytics/sessionDuration.ts`): missing/invalid -> "Unknown", up to 10 s of clock skew -> 0, no cap (a 4-day genuine session shows as 4 days). New presence rows stamp `started_at` and `last_seen` together.
- The "72 hours" the owner saw is **not a session duration**: it is Microsoft Clarity's Data Export API limit (`numOfDays` 1-3 = last 24/48/72 hours). It appears in Admin -> Exports -> Clarity ("Last 72 hours"). Longest real session in `live_sessions` on 2026-10-28: 5 h 35 m; none over 24 h.
