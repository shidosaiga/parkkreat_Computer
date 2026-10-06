create table if not exists public.business_hours (
  id boolean primary key default true check (id),
  open_time time not null default time '09:00',
  close_time time not null default time '18:30',
  updated_at timestamptz not null default now(),
  constraint business_hours_open_before_close check (open_time < close_time)
);

insert into public.business_hours (id, open_time, close_time)
values (true, time '09:00', time '18:30')
on conflict (id) do nothing;

alter table public.business_hours enable row level security;
revoke all on public.business_hours from anon, authenticated;

create or replace function public.get_public_business_hours()
returns table (open_time text, close_time text)
language sql
stable
security definer
set search_path = public
as $$
  select to_char(b.open_time, 'HH24:MI'), to_char(b.close_time, 'HH24:MI')
  from public.business_hours as b
  where b.id = true;
$$;

create or replace function public.update_business_hours(
  p_open_time time,
  p_close_time time
)
returns table (open_time text, close_time text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_queue_admin() then raise exception 'Not authorized'; end if;
  if p_open_time is null or p_close_time is null or p_open_time >= p_close_time then
    raise exception 'Opening time must be earlier than closing time';
  end if;

  update public.business_hours as b
  set open_time = p_open_time,
      close_time = p_close_time,
      updated_at = now()
  where b.id = true;

  return query
  select to_char(b.open_time, 'HH24:MI'), to_char(b.close_time, 'HH24:MI')
  from public.business_hours as b
  where b.id = true;
end;
$$;

revoke all on function public.get_public_business_hours() from public;
grant execute on function public.get_public_business_hours() to anon, authenticated;
revoke all on function public.update_business_hours(time, time) from public;
grant execute on function public.update_business_hours(time, time) to authenticated;
