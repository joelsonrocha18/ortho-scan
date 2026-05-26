begin;

insert into storage.buckets (id, name, public)
values ('orthoscan-files', 'orthoscan-files', true)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;

drop policy if exists "orthoscan_files_select" on storage.objects;
drop policy if exists "orthoscan_files_insert" on storage.objects;
drop policy if exists "orthoscan_files_update" on storage.objects;
drop policy if exists "orthoscan_files_delete" on storage.objects;

create policy "orthoscan_files_select"
on storage.objects
for select
to public
using (
  bucket_id = 'orthoscan-files'
);

create policy "orthoscan_files_insert"
on storage.objects
for insert
to public
with check (
  bucket_id = 'orthoscan-files'
);

create policy "orthoscan_files_update"
on storage.objects
for update
to public
using (
  bucket_id = 'orthoscan-files'
)
with check (
  bucket_id = 'orthoscan-files'
);

create policy "orthoscan_files_delete"
on storage.objects
for delete
to public
using (
  bucket_id = 'orthoscan-files'
);

commit;
