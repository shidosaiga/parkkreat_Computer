alter table public.queue_admins
  add column if not exists role text not null default 'technician';

alter table public.queue_admins
  drop constraint if exists queue_admins_role_check;

alter table public.queue_admins
  add constraint queue_admins_role_check check (role in ('owner', 'technician'));

-- Keep the earliest existing queue administrator as the shop owner.
with first_admin as (
  select user_id
  from public.queue_admins
  order by created_at asc, user_id asc
  limit 1
)
update public.queue_admins
set role = case when user_id = (select user_id from first_admin) then 'owner' else 'technician' end;

create or replace function public.has_queue_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.queue_admins where user_id = auth.uid());
$$;

create or replace function public.is_queue_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.queue_admins
    where user_id = auth.uid() and role = 'owner'
  )
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and coalesce(auth.jwt() -> 'amr', '[]'::jsonb) @> '[{"method":"totp"}]'::jsonb;
$$;

revoke all on function public.has_queue_access() from public;
grant execute on function public.has_queue_access() to authenticated;
revoke all on function public.is_queue_owner() from public;
grant execute on function public.is_queue_owner() to authenticated;
