-- Private Storage bucket for saved documents.
--
-- Objects are keyed "<user-id>/<document-id>/document.pdf" so a Storage RLS
-- policy can restrict every operation to the first path segment matching the
-- caller's own auth.uid() -- no service-role key is required for the normal
-- save/read/delete path from the browser, since the user's own (anon-key)
-- session is enough under RLS.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "Users can read their own documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload their own documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own documents"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No policy targets the `anon` role, so guests get no access to this bucket
-- at all -- consistent with "do not create permanent storage for guests."
