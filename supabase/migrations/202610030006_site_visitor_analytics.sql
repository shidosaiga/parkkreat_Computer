create table if not exists public.site_visit_events (
  event_id uuid primary key,
  visitor_id uuid not null,
  session_id uuid not null,
  event_type text not null check (event_type in ('page_view', 'engaged')),
  created_at timestamptz not null default now()
);

create index if not exists site_visit_events_created_at_idx
  on public.site_visit_events (created_at desc);
create index if not exists site_visit_events_visitor_created_idx
  on public.site_visit_events (visitor_id, created_at desc);

alter table public.site_visit_events enable row level security;
revoke all on public.site_visit_events from public, anon, authenticated;

create or replace function public.get_site_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  day_count integer := greatest(1, least(coalesce(p_days, 30), 365));
  result jsonb;
begin
  if not public.is_queue_admin() then
    raise exception 'Not authorized';
  end if;

  with summary as (
    select
      count(*) filter (where event_type = 'page_view') as page_views,
      count(distinct visitor_id) filter (where event_type = 'page_view') as unique_visitors,
      count(distinct session_id) filter (where event_type = 'page_view') as sessions,
      count(distinct session_id) filter (where event_type = 'engaged') as engaged_sessions
    from public.site_visit_events
  ),
  date_range as (
    select (timezone('Asia/Bangkok', now())::date - (day_count - 1)) as first_day,
           timezone('Asia/Bangkok', now())::date as last_day
  ),
  calendar as (
    select generate_series(first_day, last_day, interval '1 day')::date as day
    from date_range
  ),
  daily as (
    select
      (e.created_at at time zone 'Asia/Bangkok')::date as day,
      count(*) filter (where e.event_type = 'page_view') as page_views,
      count(distinct e.visitor_id) filter (where e.event_type = 'page_view') as unique_visitors,
      count(distinct e.session_id) filter (where e.event_type = 'engaged') as engaged_sessions
    from public.site_visit_events e, date_range d
    where e.created_at >= (d.first_day::timestamp at time zone 'Asia/Bangkok')
      and e.created_at < ((d.last_day + 1)::timestamp at time zone 'Asia/Bangkok')
    group by 1
  )
  select jsonb_build_object(
    'summary', (select to_jsonb(summary) from summary),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(calendar.day, 'YYYY-MM-DD'),
        'page_views', coalesce(daily.page_views, 0),
        'unique_visitors', coalesce(daily.unique_visitors, 0),
        'engaged_sessions', coalesce(daily.engaged_sessions, 0)
      ) order by calendar.day)
      from calendar left join daily using (day)
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_site_analytics(integer) from public;
grant execute on function public.get_site_analytics(integer) to authenticated;
