-- Public Storage bucket for ad/banner creative media (images + self-hosted
-- video). Public reads bypass RLS entirely (Supabase public-bucket behavior),
-- since banners must be visible to anonymous site visitors via ads-eligible.
-- Writes are restricted to active admin/super_admin users -- the same role
-- check admin-ads already performs server-side.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ad-assets', 'ad-assets', true, 41943040) -- 40MB ceiling (video)
on conflict (id) do nothing;

-- storage.objects itself has RLS, and admin_users (which the write policies
-- need to check) ALSO has its own deny-all RLS for authenticated/anon -- a
-- raw subquery in the policy would hit "permission denied for table
-- admin_users" before it could even evaluate, since the policy runs as the
-- caller's role. A SECURITY DEFINER function bridges this the standard way:
-- it runs with the function owner's privilege for its own body, while the
-- caller still needs (and is granted, below) EXECUTE to invoke it at all.
create function public.ad_assets_caller_is_admin()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.admin_users au
    where au.user_id = auth.uid() and au.is_active and au.role in ('super_admin', 'admin')
  );
end;
$$;

-- Only `authenticated` may call this (needed so the Storage RLS policies
-- below, which evaluate as that role, can invoke it) -- not `anon`, and not
-- as a general-purpose public RPC endpoint. It only ever reveals whether the
-- CALLING user themselves is an ad-admin, never other users' data.
revoke all on function public.ad_assets_caller_is_admin() from public;
grant execute on function public.ad_assets_caller_is_admin() to authenticated;

-- Needed for x-upsert (INSERT ... ON CONFLICT DO UPDATE, used by
-- utils/admin/uploadAdAsset.ts to support "replace"): Postgres requires a
-- SELECT policy to satisfy the conflict-detection read, even for a brand new
-- path with no actual conflicting row yet. The bucket's own public=true flag
-- only bypasses RLS for the public URL read endpoint, not this SQL-level
-- check, so a real SELECT policy is required in addition to that.
create policy "Anyone can list ad assets"
  on storage.objects for select
  to public
  using (bucket_id = 'ad-assets');

create policy "Admins can upload ad assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ad-assets' and public.ad_assets_caller_is_admin());

create policy "Admins can replace ad assets"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'ad-assets' and public.ad_assets_caller_is_admin())
  with check (bucket_id = 'ad-assets' and public.ad_assets_caller_is_admin());

create policy "Admins can delete ad assets"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'ad-assets' and public.ad_assets_caller_is_admin());

-- ad_creatives: describe what's rendered AS the banner itself (media_type),
-- independent of destination_type (which is about the click-through: a
-- normal link vs. a trusted iframe embed). storage_path/mime_type/
-- file_size_bytes are null for externally-hosted (advertiser-supplied)
-- asset_url values; they're only populated when the asset was uploaded to
-- our own ad-assets bucket, so a creative delete/replace can clean up the
-- underlying Storage object instead of leaking it.
alter table public.ad_creatives
  add column media_type text not null default 'image' check (media_type in ('image', 'video')),
  add column storage_path text,
  add column mime_type text,
  add column file_size_bytes bigint;
