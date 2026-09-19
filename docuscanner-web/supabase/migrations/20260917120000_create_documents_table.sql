-- Saved-document metadata for authenticated users.
--
-- Guest processing output is NOT recorded here -- it stays in the backend's
-- temporary storage (see backend/src/db/schema.sql conversion_history) and
-- expires on the existing TTL cleanup. A row only exists here once a signed-in
-- user explicitly clicks "Save," at which point the finished PDF has already
-- been uploaded to the private `documents` Storage bucket by the browser
-- (see the companion storage migration).
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled document',
  storage_path text not null,
  mime_type text not null default 'application/pdf',
  file_size bigint not null,
  page_count integer,
  is_password_protected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_user_id_idx on public.documents (user_id);

alter table public.documents enable row level security;

-- No policy is created for anonymous/guest access, so RLS denies anonymous
-- reads and writes by default -- guests never get a row here regardless of
-- what the application layer does.

create policy "Users can view their own documents"
  on public.documents for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own documents"
  on public.documents for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own documents"
  on public.documents for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own documents"
  on public.documents for delete
  to authenticated
  using (auth.uid() = user_id);
