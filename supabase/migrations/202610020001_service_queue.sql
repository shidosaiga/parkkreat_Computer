create table if not exists public.queue_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.queue_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  customer_name text not null,
  phone text not null,
  device text not null default '',
  symptoms text not null,
  tasks jsonb not null default '[]'::jsonb,
  programs jsonb not null default '[]'::jsonb,
  photo_paths text[] not null default '{}',
  estimated_total integer not null check (estimated_total >= 200),
  status text not null default 'WAIT'
    check (status in ('WAIT', 'PROCESS', 'FINISH', 'CANCEL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists queue_requests_created_at_idx
  on public.queue_requests (created_at desc);

create or replace function public.set_queue_request_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists queue_requests_updated_at on public.queue_requests;
create trigger queue_requests_updated_at
before update on public.queue_requests
for each row execute function public.set_queue_request_updated_at();

create or replace function public.is_queue_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.queue_admins
    where user_id = auth.uid()
  )
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and coalesce(auth.jwt() -> 'amr', '[]'::jsonb) @> '[{"method":"totp"}]'::jsonb;
$$;

revoke all on function public.is_queue_admin() from public;
grant execute on function public.is_queue_admin() to authenticated;

alter table public.queue_admins enable row level security;
alter table public.queue_requests enable row level security;

drop policy if exists "queue admins can read their own membership" on public.queue_admins;
create policy "queue admins can read their own membership"
on public.queue_admins for select to authenticated
using (user_id = auth.uid());

drop policy if exists "queue admins can read requests" on public.queue_requests;
create policy "queue admins can read requests"
on public.queue_requests for select to authenticated
using (public.is_queue_admin());

drop policy if exists "queue admins can update request status" on public.queue_requests;
create policy "queue admins can update request status"
on public.queue_requests for update to authenticated
using (public.is_queue_admin())
with check (public.is_queue_admin());

drop policy if exists "queue requests require technician TOTP" on public.queue_requests;
create policy "queue requests require technician TOTP"
on public.queue_requests as restrictive for all to authenticated
using (public.is_queue_admin())
with check (public.is_queue_admin());

revoke all on public.queue_requests from anon, authenticated;
grant select on public.queue_requests to authenticated;
grant update (status) on public.queue_requests to authenticated;
revoke all on public.queue_admins from anon, authenticated;
grant select on public.queue_admins to authenticated;

create or replace function public.lookup_queue_status(
  p_phone text,
  p_ticket_code text
)
returns table (
  ticket_code text,
  status text,
  estimated_total integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    q.ticket_code,
    q.status,
    q.estimated_total,
    q.created_at,
    q.updated_at
  from public.queue_requests as q
  where regexp_replace(q.phone, '[^0-9]', '', 'g') = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    and upper(q.ticket_code) = upper(trim(coalesce(p_ticket_code, '')))
  limit 1;
$$;

revoke all on function public.lookup_queue_status(text, text) from public;
grant execute on function public.lookup_queue_status(text, text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('queue-photos', 'queue-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "queue admins can read request photos" on storage.objects;
create policy "queue admins can read request photos"
on storage.objects for select to authenticated
using (bucket_id = 'queue-photos' and public.is_queue_admin());

drop policy if exists "queue photos require technician TOTP" on storage.objects;
create policy "queue photos require technician TOTP"
on storage.objects as restrictive for select to authenticated
using (bucket_id = 'queue-photos' and public.is_queue_admin());