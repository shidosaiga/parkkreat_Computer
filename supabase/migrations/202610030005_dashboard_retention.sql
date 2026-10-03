create table if not exists public.queue_retention_settings (
  id boolean primary key default true check (id),
  cancel_minutes integer not null default 1 check (cancel_minutes between 0 and 525600),
  finish_minutes integer not null default 0 check (finish_minutes between 0 and 525600),
  updated_at timestamptz not null default now()
);

insert into public.queue_retention_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.queue_requests add column if not exists delete_after_at timestamptz;

update public.queue_requests q
set delete_after_at = q.cancelled_at + make_interval(mins => s.cancel_minutes)
from public.queue_retention_settings s
where s.id = true and q.status = 'CANCEL' and q.delete_after_at is null
  and q.cancelled_at is not null and s.cancel_minutes > 0;

create index if not exists queue_requests_delete_after_at_idx
  on public.queue_requests (delete_after_at) where delete_after_at is not null;

create or replace function public.set_queue_request_updated_at()
returns trigger language plpgsql set search_path = public as $$
declare
  retention_minutes integer;
begin
  new.updated_at = now();
  if new.status in ('CANCEL', 'FINISH') then
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      if new.status = 'CANCEL' then
        new.cancelled_at = now();
        select cancel_minutes into retention_minutes from public.queue_retention_settings where id = true;
      else
        new.cancelled_at = null;
        select finish_minutes into retention_minutes from public.queue_retention_settings where id = true;
      end if;
      new.delete_after_at := case when coalesce(retention_minutes, 0) > 0
        then now() + make_interval(mins => retention_minutes) else null end;
    end if;
  else
    new.cancelled_at = null;
    new.delete_after_at = null;
  end if;
  return new;
end;
$$;

create or replace function public.get_queue_retention_settings()
returns table (cancel_minutes integer, finish_minutes integer)
language sql stable security invoker set search_path = public as $$
  select s.cancel_minutes, s.finish_minutes
  from public.queue_retention_settings s
  where s.id = true and public.is_queue_admin();
$$;

create or replace function public.update_queue_retention_settings(
  p_cancel_minutes integer, p_finish_minutes integer
)
returns table (cancel_minutes integer, finish_minutes integer)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_queue_admin() then raise exception 'Not authorized'; end if;
  if p_cancel_minutes not between 0 and 525600 or p_finish_minutes not between 0 and 525600 then
    raise exception 'Retention must be between 0 and 525600 minutes';
  end if;
  update public.queue_retention_settings
  set cancel_minutes = p_cancel_minutes, finish_minutes = p_finish_minutes, updated_at = now()
  where id = true;
  update public.queue_requests
  set delete_after_at = case
    when status = 'CANCEL' and p_cancel_minutes > 0
      then coalesce(cancelled_at, now()) + make_interval(mins => p_cancel_minutes)
    when status = 'FINISH' and p_finish_minutes > 0
      then now() + make_interval(mins => p_finish_minutes)
    else null end
  where status in ('CANCEL', 'FINISH');
  return query select s.cancel_minutes, s.finish_minutes
    from public.queue_retention_settings s where s.id = true;
end;
$$;

alter table public.queue_retention_settings enable row level security;
revoke all on public.queue_retention_settings from anon, authenticated;
grant select on public.queue_retention_settings to authenticated;
drop policy if exists "queue admins can read retention settings" on public.queue_retention_settings;
create policy "queue admins can read retention settings"
on public.queue_retention_settings for select to authenticated using (public.is_queue_admin());

revoke all on function public.get_queue_retention_settings() from public;
grant execute on function public.get_queue_retention_settings() to authenticated;
revoke all on function public.update_queue_retention_settings(integer, integer) from public;
grant execute on function public.update_queue_retention_settings(integer, integer) to authenticated;

drop policy if exists "queue admins can delete requests" on public.queue_requests;
create policy "queue admins can delete requests"
on public.queue_requests for delete to authenticated using (public.is_queue_admin());
grant delete on public.queue_requests to authenticated;

drop policy if exists "queue admins can delete request photos" on storage.objects;
create policy "queue admins can delete request photos"
on storage.objects for delete to authenticated
using (bucket_id = 'queue-photos' and public.is_queue_admin());
