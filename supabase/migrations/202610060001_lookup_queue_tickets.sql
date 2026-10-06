create or replace function public.lookup_queue_tickets(
  p_phone text
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
  where length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 9
    and regexp_replace(q.phone, '[^0-9]', '', 'g') = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  order by q.created_at desc
  limit 50;
$$;

revoke all on function public.lookup_queue_tickets(text) from public;
grant execute on function public.lookup_queue_tickets(text) to service_role;
