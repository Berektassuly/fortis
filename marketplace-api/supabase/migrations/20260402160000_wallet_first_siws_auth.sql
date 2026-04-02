begin;

drop trigger if exists on_auth_user_changed on auth.users;

create or replace function public.extract_solana_wallet_address_from_payload(payload jsonb)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      coalesce(
        payload -> 'custom_claims' ->> 'address',
        payload ->> 'address',
        case
          when coalesce(payload ->> 'sub', '') like 'solana:%' then
            split_part(payload ->> 'sub', ':', array_length(string_to_array(payload ->> 'sub', ':'), 1))
          else null
        end
      )
    ),
    ''
  );
$$;

create or replace function public.get_solana_wallet_address_for_auth_user(p_auth_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  with auth_identity as (
    select identities.identity_data
    from auth.identities as identities
    where identities.user_id = p_auth_user_id
      and identities.provider in ('solana', 'eip4361')
    order by identities.last_sign_in_at desc nulls last, identities.created_at desc nulls last
    limit 1
  )
  select coalesce(
    public.extract_solana_wallet_address_from_payload(auth_users.raw_user_meta_data),
    public.extract_solana_wallet_address_from_payload((select identity_data from auth_identity))
  )
  from auth.users as auth_users
  where auth_users.id = p_auth_user_id;
$$;

create or replace function public.current_solana_wallet_address()
returns text
language sql
stable
as $$
  select public.get_solana_wallet_address_for_auth_user(auth.uid());
$$;

do $$
begin
  if exists (
    select 1
    from public.users
    where auth_user_id is not null
      and solana_wallet_address is not null
      and solana_wallet_address <> public.get_solana_wallet_address_for_auth_user(auth_user_id)
  ) then
    raise exception 'Existing public.users rows are linked to a different wallet than the current SIWS identity metadata. Resolve the mismatches before applying the wallet-first migration.';
  end if;
end $$;

update public.users
set
  solana_wallet_address = public.get_solana_wallet_address_for_auth_user(auth_user_id),
  updated_at = timezone('utc', now())
where auth_user_id is not null
  and solana_wallet_address is null;

do $$
begin
  if exists (
    select 1
    from public.users
    where solana_wallet_address is null
  ) then
    raise exception 'All marketplace users must have a Solana wallet address before switching to SIWS-only auth. Remove or migrate legacy email-only profiles first.';
  end if;

  if exists (
    select 1
    from public.users
    group by solana_wallet_address
    having count(*) > 1
  ) then
    raise exception 'Duplicate public.users.solana_wallet_address values found. Resolve duplicates before applying the wallet-first migration.';
  end if;
end $$;

alter table public.listings
  add column if not exists owner_wallet_address text;

update public.listings as listings_table
set owner_wallet_address = users_table.solana_wallet_address
from public.users as users_table
where listings_table.owner_id is not null
  and users_table.id = listings_table.owner_id;

alter table public.orders
  add column if not exists user_wallet_address text;

update public.orders as orders_table
set user_wallet_address = users_table.solana_wallet_address
from public.users as users_table
where orders_table.user_id is not null
  and users_table.id = orders_table.user_id;

do $$
begin
  if exists (
    select 1
    from public.listings
    where owner_id is not null
      and owner_wallet_address is null
  ) then
    raise exception 'Failed to backfill listings.owner_id to wallet-based ownership. Resolve orphaned listing owners before continuing.';
  end if;

  if exists (
    select 1
    from public.orders
    where user_id is not null
      and user_wallet_address is null
  ) then
    raise exception 'Failed to backfill orders.user_id to wallet-based ownership. Resolve orphaned order users before continuing.';
  end if;
end $$;

alter table public.listings
  drop constraint if exists listings_owner_id_fkey;

alter table public.orders
  drop constraint if exists orders_user_id_fkey;

drop index if exists public.listings_owner_id_idx;
drop index if exists public.orders_user_id_idx;

alter table public.users
  drop constraint if exists users_wallet_matches_id_check;

alter table public.users
  drop constraint if exists users_pkey;

alter table public.users
  drop constraint if exists users_email_key;

alter table public.users
  alter column solana_wallet_address set not null;

alter table public.users
  alter column id drop identity if exists;

alter table public.users
  alter column id type text
  using solana_wallet_address;

alter table public.users
  drop column if exists email,
  drop column if exists password_hash;

alter table public.users
  add constraint users_pkey primary key (id);

alter table public.users
  drop constraint if exists users_solana_wallet_address_key;

drop index if exists public.users_solana_wallet_address_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_solana_wallet_address_key'
  ) then
    alter table public.users
      add constraint users_solana_wallet_address_key unique (solana_wallet_address);
  end if;
end $$;

alter table public.users
  add constraint users_wallet_matches_id_check
  check (id = solana_wallet_address);

alter table public.listings
  drop column owner_id;

alter table public.listings
  rename column owner_wallet_address to owner_id;

alter table public.listings
  add constraint listings_owner_id_fkey
  foreign key (owner_id)
  references public.users (id)
  on update cascade
  on delete set null;

alter table public.orders
  drop column user_id;

alter table public.orders
  rename column user_wallet_address to user_id;

alter table public.orders
  add constraint orders_user_id_fkey
  foreign key (user_id)
  references public.users (id)
  on update cascade
  on delete set null;

create index if not exists listings_owner_id_idx on public.listings (owner_id);
create index if not exists orders_user_id_idx on public.orders (user_id);

create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  resolved_wallet_address text;
begin
  if tg_op = 'DELETE' then
    update public.users
    set
      auth_user_id = null,
      updated_at = timezone('utc', now())
    where auth_user_id = old.id;

    return old;
  end if;

  resolved_wallet_address := public.get_solana_wallet_address_for_auth_user(new.id);

  if resolved_wallet_address is null then
    return new;
  end if;

  update public.users
  set
    auth_user_id = null,
    updated_at = timezone('utc', now())
  where auth_user_id = new.id;

  insert into public.users (
    id,
    auth_user_id,
    solana_wallet_address,
    created_at,
    updated_at
  )
  values (
    resolved_wallet_address,
    new.id,
    resolved_wallet_address,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do update
    set
      auth_user_id = excluded.auth_user_id,
      solana_wallet_address = excluded.solana_wallet_address,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

create trigger on_auth_user_changed
after insert or update of raw_app_meta_data, raw_user_meta_data or delete on auth.users
for each row
execute function public.handle_auth_user_change();

insert into public.users (
  id,
  auth_user_id,
  solana_wallet_address,
  created_at,
  updated_at
)
select
  resolved_wallet_address,
  auth_users.id,
  resolved_wallet_address,
  timezone('utc', now()),
  timezone('utc', now())
from auth.users as auth_users
cross join lateral (
  select public.get_solana_wallet_address_for_auth_user(auth_users.id) as resolved_wallet_address
) as wallet_identity
where wallet_identity.resolved_wallet_address is not null
on conflict (id) do update
  set
    auth_user_id = excluded.auth_user_id,
    solana_wallet_address = excluded.solana_wallet_address,
    updated_at = timezone('utc', now());

drop policy if exists "Users can read their profile" on public.users;
create policy "Users can read their profile"
on public.users
for select
to authenticated
using (
  id = public.current_solana_wallet_address()
  and auth.uid() = auth_user_id
);

drop policy if exists "Users can insert their profile" on public.users;
create policy "Users can insert their profile"
on public.users
for insert
to authenticated
with check (
  auth.uid() = auth_user_id
  and id = public.current_solana_wallet_address()
  and solana_wallet_address = public.current_solana_wallet_address()
);

drop policy if exists "Users can update their profile" on public.users;
create policy "Users can update their profile"
on public.users
for update
to authenticated
using (
  id = public.current_solana_wallet_address()
  and (auth_user_id = auth.uid() or auth_user_id is null)
)
with check (
  auth_user_id = auth.uid()
  and id = public.current_solana_wallet_address()
  and solana_wallet_address = public.current_solana_wallet_address()
);

drop policy if exists "Public can read active listings" on public.listings;
create policy "Public can read active listings"
on public.listings
for select
using (
  tokenization_status = 'active'
  or owner_id = public.current_solana_wallet_address()
);

drop policy if exists "Owners can insert listings" on public.listings;
create policy "Owners can insert listings"
on public.listings
for insert
to authenticated
with check (
  owner_id = public.current_solana_wallet_address()
  and seller_wallet_address = public.current_solana_wallet_address()
);

drop policy if exists "Owners can update listings" on public.listings;
create policy "Owners can update listings"
on public.listings
for update
to authenticated
using (owner_id = public.current_solana_wallet_address())
with check (
  owner_id = public.current_solana_wallet_address()
  and coalesce(seller_wallet_address, public.current_solana_wallet_address()) = public.current_solana_wallet_address()
);

drop policy if exists "Buyers can read their orders" on public.orders;
create policy "Buyers can read their orders"
on public.orders
for select
to authenticated
using (user_id = public.current_solana_wallet_address());

drop policy if exists "Buyers can insert their orders" on public.orders;
create policy "Buyers can insert their orders"
on public.orders
for insert
to authenticated
with check (
  user_id = public.current_solana_wallet_address()
  and buyer_wallet_address = public.current_solana_wallet_address()
);

drop policy if exists "Buyers can update their orders" on public.orders;
create policy "Buyers can update their orders"
on public.orders
for update
to authenticated
using (user_id = public.current_solana_wallet_address())
with check (
  user_id = public.current_solana_wallet_address()
  and buyer_wallet_address = public.current_solana_wallet_address()
);

drop policy if exists "Authenticated users can upload listing images" on storage.objects;
create policy "Authenticated users can upload listing images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listings'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = public.current_solana_wallet_address()
);

drop policy if exists "Authenticated users can delete their listing images" on storage.objects;
create policy "Authenticated users can delete their listing images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'listings'
  and auth.uid() is not null
  and (
    (storage.foldername(name))[1] = public.current_solana_wallet_address()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

commit;
