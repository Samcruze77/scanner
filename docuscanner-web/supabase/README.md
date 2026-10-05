# Supabase sources

Project: **DocuScanner-web** (`zdegimgixjpirtivrrgc`, eu-west-1, Postgres 17).

## Edge Functions (`functions/`)

All ten deployed functions now have source here. Each one is deployed with
`verify_jwt = false` on purpose (see `config.toml`); they authenticate through
`@supabase/server`'s `withSupabase({ auth: ... })` modes instead.

| Function | Notes |
| --- | --- |
| `track-analytics`, `heartbeat`, `track-ad-event` | Write paths. Accept only the secret key, called by the `/api/analytics/*` Route Handlers. |
| `ads-eligible` | Public read path for ad delivery. Uses `SUPABASE_SERVICE_ROLE_KEY`. |
| `admin-analytics`, `admin-analytics-export` | Dashboard aggregations and export paging. |
| `admin-ads`, `admin-users`, `admin-live` | Admin APIs (role-gated through `admin_users`). |
| `delete-account` | Owner-initiated account deletion. |

`ads-eligible`, `admin-ads`, `admin-users` and `admin-live` were exported from
the deployed versions on 2026-10-05 (v3, v4, v6 and v3) because they previously
existed only on Supabase. They are copied verbatim, including the leading blank
line. Functions are **not** deployed by Vercel or by merging to `web-only`;
deploy with:

```
supabase functions deploy <slug> --project-ref zdegimgixjpirtivrrgc
```

If you edit one, redeploy it and note the new version, since the deployed copy
and this copy can drift.

## Schema

`migrations/` holds only part of the history (8 files). Production has about 38
recorded migrations, several of them QA or debugging steps. The live database is
the source of truth.

`schema/baseline_2026-10-05.sql` is a snapshot of the production schema (tables,
constraints, indexes, RLS, policies, functions, trigger, buckets). It is
documentation and a starting point for a fresh project, **not** something to run
against production. Create new migrations from this baseline forward, and
regenerate the snapshot after any significant schema change.
