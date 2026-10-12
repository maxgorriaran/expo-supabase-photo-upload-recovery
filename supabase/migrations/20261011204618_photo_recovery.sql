-- A private, create-only image plus one immutable database identity per capture.
create table public.photo_saves (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  object_path text generated always as (owner_id::text || '/' || id::text || '.jpg') stored,
  state text not null check (state in ('ready', 'deleted')),
  created_at timestamptz not null default now()
);
alter table public.photo_saves enable row level security;
revoke all on public.photo_saves from public, anon, authenticated;
grant select, insert, update on public.photo_saves to authenticated;
create policy "Owners read their photo records" on public.photo_saves
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners insert their photo records" on public.photo_saves
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners update their photo records" on public.photo_saves
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-recovery', 'photo-recovery', false, 4194304, array['image/jpeg']);

create policy "Owners inspect their active recovery images" on storage.objects
for select to authenticated using (
  bucket_id = 'photo-recovery'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and not exists (
    select 1 from public.photo_saves p where p.object_path = name and p.state = 'deleted'
  )
);
create policy "Owners create recovery images once" on storage.objects
for insert to authenticated with check (
  bucket_id = 'photo-recovery'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
  and not exists (
    select 1 from public.photo_saves p where p.object_path = name and p.state = 'deleted'
  )
);
-- Intentionally no UPDATE or DELETE policy for this bucket. Retention cleanup is a server task.

create function public.enforce_photo_save() returns trigger
language plpgsql security invoker set search_path = public, storage, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.owner_id <> old.owner_id or new.created_at <> old.created_at then
      raise exception 'Capture identity is immutable';
    end if;
    if old.state = 'deleted' and new.state <> 'deleted' then
      raise exception 'A deleted capture cannot be restored';
    end if;
  end if;
  if new.state = 'ready' and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'photo-recovery'
      and o.name = new.owner_id::text || '/' || new.id::text || '.jpg'
      and o.metadata->>'mimetype' = 'image/jpeg'
      and case when o.metadata->>'size' ~ '^[0-9]+$'
        then (o.metadata->>'size')::numeric between 1 and 4194304 else false end
  ) then
    raise exception 'A ready photo requires a nonempty stored JPEG';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_photo_save() from public;
grant execute on function public.enforce_photo_save() to authenticated;
create trigger enforce_photo_save before insert or update on public.photo_saves
for each row execute function public.enforce_photo_save();
