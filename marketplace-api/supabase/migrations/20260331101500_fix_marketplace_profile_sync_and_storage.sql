begin;

insert into public.users (
  auth_user_id,
  email,
  created_at,
  updated_at
)
select
  auth_users.id,
  coalesce(lower(auth_users.email), auth_users.id::text || '@auth.local'),
  timezone('utc', now()),
  timezone('utc', now())
from auth.users as auth_users
where not exists (
  select 1
  from public.users as users_table
  where users_table.auth_user_id = auth_users.id
)
and not exists (
  select 1
  from public.users as users_table
  where lower(users_table.email) = lower(
    coalesce(auth_users.email, auth_users.id::text || '@auth.local')
  )
)
on conflict (auth_user_id) do update
  set email = excluded.email,
      updated_at = timezone('utc', now());

create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
begin
  if tg_op = 'INSERT' then
    normalized_email := coalesce(lower(new.email), new.id::text || '@auth.local');

    update public.users
    set
      auth_user_id = new.id,
      email = normalized_email,
      updated_at = timezone('utc', now())
    where auth_user_id is null
      and lower(email) = normalized_email;

    if not found then
      insert into public.users (
        auth_user_id,
        email,
        created_at,
        updated_at
      )
      values (
        new.id,
        normalized_email,
        timezone('utc', now()),
        timezone('utc', now())
      )
      on conflict (auth_user_id) do update
        set email = excluded.email,
            updated_at = timezone('utc', now());
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    normalized_email := coalesce(lower(new.email), new.id::text || '@auth.local');

    update public.users
    set
      email = normalized_email,
      updated_at = timezone('utc', now())
    where auth_user_id = new.id;

    if not found then
      update public.users
      set
        auth_user_id = new.id,
        email = normalized_email,
        updated_at = timezone('utc', now())
      where auth_user_id is null
        and lower(email) = normalized_email;

      if not found then
        insert into public.users (
          auth_user_id,
          email,
          created_at,
          updated_at
        )
        values (
          new.id,
          normalized_email,
          timezone('utc', now()),
          timezone('utc', now())
        )
        on conflict (auth_user_id) do update
          set email = excluded.email,
              updated_at = timezone('utc', now());
      end if;
    end if;

    return new;
  end if;

  update public.users
  set
    auth_user_id = null,
    updated_at = timezone('utc', now())
  where auth_user_id = old.id;

  return old;
end;
$$;

drop policy if exists "Users can insert their profile" on public.users;
create policy "Users can insert their profile"
on public.users
for insert
to authenticated
with check (auth.uid() = auth_user_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'listings',
  'listings',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view listing images" on storage.objects;
create policy "Public can view listing images"
on storage.objects
for select
using (bucket_id = 'listings');

drop policy if exists "Authenticated users can upload listing images" on storage.objects;
create policy "Authenticated users can upload listing images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listings'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Authenticated users can delete their listing images" on storage.objects;
create policy "Authenticated users can delete their listing images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'listings'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

commit;
