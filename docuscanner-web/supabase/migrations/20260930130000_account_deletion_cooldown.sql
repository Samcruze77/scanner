-- Account deletion: a signed-in user can delete their own account (Edge
-- Function `delete-account`). The address of a deleted account cannot be used
-- to sign up again for 24 hours; after that it can, at any time.
--
-- Only a one-way hash of the email is kept, only for the cool-down, in a table
-- with RLS on and no policies (readable/writable by the service role only).
-- The rule is enforced in the database (a BEFORE INSERT trigger on auth.users),
-- so it cannot be bypassed by calling the auth API directly.

create table if not exists public.deleted_account_cooldowns (
  email_hash text primary key,
  deleted_at timestamptz not null default now()
);

alter table public.deleted_account_cooldowns enable row level security;
revoke all on table public.deleted_account_cooldowns from public, anon, authenticated;

comment on table public.deleted_account_cooldowns is
  'SHA-256 of lower(trim(email)) for accounts deleted by their owner, kept 24h to enforce the re-signup cool-down. Service role only (RLS on, no policies).';

create index if not exists deleted_account_cooldowns_deleted_at_idx
  on public.deleted_account_cooldowns (deleted_at);

create or replace function public.email_cooldown_hash(address text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(lower(btrim(address)), 'UTF8')), 'hex')
$$;

-- True while the address is inside its 24h cool-down.
create or replace function public.signup_email_in_cooldown(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deleted_account_cooldowns c
    where c.email_hash = public.email_cooldown_hash(check_email)
      and c.deleted_at > now() - interval '24 hours'
  )
$$;

revoke all on function public.signup_email_in_cooldown(text) from public, anon, authenticated;
grant execute on function public.signup_email_in_cooldown(text) to service_role;

create or replace function public.block_signup_during_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and public.signup_email_in_cooldown(new.email) then
    raise exception 'account_recently_deleted'
      using errcode = 'P0001',
            hint = 'This address belongs to an account deleted less than 24 hours ago.';
  end if;
  return new;
end
$$;

revoke all on function public.block_signup_during_cooldown() from public, anon, authenticated;

drop trigger if exists block_signup_during_cooldown on auth.users;
create trigger block_signup_during_cooldown
  before insert on auth.users
  for each row execute function public.block_signup_during_cooldown();
