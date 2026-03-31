begin;

-- Manual SQL Editor migration for Supabase.
-- Purpose:
-- 1. Fix auth.users -> public.users profile sync used by /api/me/wallet.
-- 2. Make upserts on auth_user_id work reliably with a real UNIQUE constraint.
-- 3. Enable RLS/policies expected by the current marketplace-api code.
-- 4. Provision the public listings storage bucket used by the create-listing flow.

-- Normalize existing records first so later constraints succeed more often.
update public.users
set
  email = lower(trim(email)),
  updated_at = timezone('utc', now())
where email <> lower(trim(email));

update public.users
set updated_at = timezone('utc', now())
where updated_at is null;

update public.listings
set
  images = coalesce(images, '{}'::text[]),
  tokenization_status = coalesce(tokenization_status, 'draft'),
  updated_at = timezone('utc', now())
where images is null
   or tokenization_status is null
   or updated_at is null;

update public.orders
set
  status = case
    when status is null then 'Created'
    when lower(status) = 'completed' then 'Success'
    else status
  end,
  updated_at = timezone('utc', now())
where status is null
   or lower(status) = 'completed'
   or updated_at is null;

-- Surface bad historical data explicitly instead of silently creating broken constraints.
do $$
begin
  if exists (
    select 1
    from public.users
    where auth_user_id is not null
    group by auth_user_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate public.users.auth_user_id values found. Resolve duplicates before running this migration.';
  end if;

  if exists (
    select 1
    from public.users
    group by lower(email)
    having count(*) > 1
  ) then
    raise exception 'Duplicate public.users.email values found (case-insensitive). Resolve duplicates before running this migration.';
  end if;

  if exists (
    select 1
    from public.users
    where solana_wallet_address is not null
    group by solana_wallet_address
    having count(*) > 1
  ) then
    raise exception 'Duplicate public.users.solana_wallet_address values found. Resolve duplicates before running this migration.';
  end if;
end $$;

-- Replace any old partial unique indexes with real UNIQUE constraints so
-- INSERT .. ON CONFLICT (auth_user_id) works in both SQL and Supabase upserts.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_email_key'
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'users_email_key'
    ) then
      execute 'drop index public.users_email_key';
    end if;

    alter table public.users
      add constraint users_email_key unique (email);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_auth_user_id_key'
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'users_auth_user_id_key'
    ) then
      execute 'drop index public.users_auth_user_id_key';
    end if;

    alter table public.users
      add constraint users_auth_user_id_key unique (auth_user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_solana_wallet_address_key'
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'users_solana_wallet_address_key'
    ) then
      execute 'drop index public.users_solana_wallet_address_key';
    end if;

    alter table public.users
      add constraint users_solana_wallet_address_key unique (solana_wallet_address);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.listings'::regclass
      and conname = 'listings_token_mint_address_key'
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'listings_token_mint_address_key'
    ) then
      execute 'drop index public.listings_token_mint_address_key';
    end if;

    alter table public.listings
      add constraint listings_token_mint_address_key unique (token_mint_address);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_nonce_key'
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'orders_nonce_key'
    ) then
      execute 'drop index public.orders_nonce_key';
    end if;

    alter table public.orders
      add constraint orders_nonce_key unique (nonce);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_fortis_request_id_key'
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'orders_fortis_request_id_key'
    ) then
      execute 'drop index public.orders_fortis_request_id_key';
    end if;

    alter table public.orders
      add constraint orders_fortis_request_id_key unique (fortis_request_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_auth_user_id_fkey'
  ) then
    alter table public.users
      add constraint users_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users (id)
      on update cascade
      on delete set null;
  end if;
end $$;

alter table public.listings
  drop constraint if exists listings_tokenization_status_check;

alter table public.listings
  add constraint listings_tokenization_status_check
  check (tokenization_status in ('draft', 'tokenizing', 'active', 'failed'));

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('Created', 'Pending', 'Processing', 'Success', 'Failed'));

create index if not exists listings_owner_id_idx on public.listings (owner_id);
create index if not exists listings_tokenization_status_idx on public.listings (tokenization_status);
create index if not exists orders_listing_id_idx on public.orders (listing_id);
create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_status_idx on public.orders (status);

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_listings_updated_at on public.listings;
create trigger set_listings_updated_at
before update on public.listings
for each row
execute function public.set_row_updated_at();

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row
execute function public.set_row_updated_at();

-- Backfill auth mappings from existing auth.users rows.
update public.users as users_table
set
  auth_user_id = auth_users.id,
  email = lower(coalesce(auth_users.email, users_table.email)),
  updated_at = timezone('utc', now())
from auth.users as auth_users
where auth_users.email is not null
  and lower(users_table.email) = lower(auth_users.email)
  and users_table.auth_user_id is distinct from auth_users.id;

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

drop trigger if exists on_auth_user_changed on auth.users;
create trigger on_auth_user_changed
after insert or update of email or delete on auth.users
for each row
execute function public.handle_auth_user_change();

grant usage on schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

grant select on public.listings to anon, authenticated, service_role;
grant insert, update on public.listings to authenticated, service_role;

grant select, insert, update on public.users to authenticated, service_role;
grant select, insert, update on public.orders to authenticated, service_role;

alter table public.users enable row level security;
alter table public.listings enable row level security;
alter table public.orders enable row level security;

drop policy if exists "Users can read their profile" on public.users;
create policy "Users can read their profile"
on public.users
for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists "Users can insert their profile" on public.users;
create policy "Users can insert their profile"
on public.users
for insert
to authenticated
with check (auth.uid() = auth_user_id);

drop policy if exists "Users can update their profile" on public.users;
create policy "Users can update their profile"
on public.users
for update
to authenticated
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

drop policy if exists "Public can read active listings" on public.listings;
create policy "Public can read active listings"
on public.listings
for select
using (
  tokenization_status = 'active'
  or exists (
    select 1
    from public.users
    where users.id = listings.owner_id
      and users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Owners can insert listings" on public.listings;
create policy "Owners can insert listings"
on public.listings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users
    where users.id = listings.owner_id
      and users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Owners can update listings" on public.listings;
create policy "Owners can update listings"
on public.listings
for update
to authenticated
using (
  exists (
    select 1
    from public.users
    where users.id = listings.owner_id
      and users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.users
    where users.id = listings.owner_id
      and users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Buyers can read their orders" on public.orders;
create policy "Buyers can read their orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.users
    where users.id = orders.user_id
      and users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Buyers can insert their orders" on public.orders;
create policy "Buyers can insert their orders"
on public.orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users
    where users.id = orders.user_id
      and users.auth_user_id = auth.uid()
  )
);

drop policy if exists "Buyers can update their orders" on public.orders;
create policy "Buyers can update their orders"
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.users
    where users.id = orders.user_id
      and users.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.users
    where users.id = orders.user_id
      and users.auth_user_id = auth.uid()
  )
);

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
