begin;

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
    public.extract_solana_wallet_address_from_payload((select identity_data from auth_identity)),
    public.extract_solana_wallet_address_from_payload(auth_users.raw_app_meta_data)
  )
  from auth.users as auth_users
  where auth_users.id = p_auth_user_id;
$$;

drop trigger if exists on_auth_user_changed on auth.users;
create trigger on_auth_user_changed
after insert or update of raw_app_meta_data or delete on auth.users
for each row
execute function public.handle_auth_user_change();

update public.users
set
  auth_user_id = null,
  updated_at = timezone('utc', now())
where auth_user_id is not null
  and id is distinct from public.get_solana_wallet_address_for_auth_user(auth_user_id);

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

commit;
