-- Reference table of administrative units, so locations can be queried and joined
-- in SQL. Until now the only "state" knowledge was a static list in the app and the
-- ISO 3166-2 package: there was no table, and nothing below state level for Nigeria.
--
-- Levels are kept distinct from cities/towns/neighborhoods (those stay free text on
-- the analytics tables): level 1 = state / province (Nigeria: 36 states + FCT),
-- level 2 = local government area, or an FCT Area Council (unit_type tells which).
--
-- Additive and idempotent. Reference data only: RLS is on with no policies, so only
-- the service role (admin Edge Functions / migrations) can read or write it.
-- Rows are loaded by supabase/seed/ng_admin_units.sql (OCHA COD-AB Nigeria, CC BY-IGO).

create table if not exists public.geo_admin_units (
  id           bigint generated always as identity primary key,
  country_code char(2)  not null check (country_code ~ '^[A-Z]{2}$'),
  code         text     not null,
  name         text     not null check (length(btrim(name)) > 0),
  unit_type    text     not null check (unit_type in ('state', 'federal_capital_territory', 'lga', 'area_council')),
  level        smallint not null check (level in (1, 2)),
  parent_code  text,
  iso_code     text,
  source       text     not null,
  created_at   timestamptz not null default now(),
  unique (country_code, code),
  -- A level-2 unit must name its parent; a level-1 unit must not have one.
  check ((level = 1 and parent_code is null) or (level = 2 and parent_code is not null)),
  foreign key (country_code, parent_code) references public.geo_admin_units (country_code, code)
);

comment on table public.geo_admin_units is
  'Administrative units per country: level 1 states/provinces, level 2 local government areas (FCT: area councils). Reference data; not a visitor location.';
comment on column public.geo_admin_units.iso_code is
  'ISO 3166-2 code for level-1 units (e.g. NG-LA); matches analytics_events.region once prefixed with the country.';

create index if not exists geo_admin_units_parent_idx on public.geo_admin_units (country_code, parent_code);
create index if not exists geo_admin_units_name_idx on public.geo_admin_units (country_code, lower(name));

alter table public.geo_admin_units enable row level security;
revoke all on public.geo_admin_units from anon, authenticated;
