alter table public.queue_retention_settings
  drop constraint if exists queue_retention_settings_cancel_minutes_check,
  drop constraint if exists queue_retention_settings_finish_minutes_check;

alter table public.queue_retention_settings
  add constraint queue_retention_settings_cancel_minutes_check
    check (cancel_minutes between 0 and 15768000),
  add constraint queue_retention_settings_finish_minutes_check
    check (finish_minutes between 0 and 15768000);

create or replace function public.update_queue_retention_settings(
  p_cancel_minutes integer, p_finish_minutes integer
)
returns table (cancel_minutes integer, finish_minutes integer)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_queue_admin() then raise exception 'Not authorized'; end if;
  if p_cancel_minutes not between 0 and 15768000 or p_finish_minutes not between 0 and 15768000 then
    raise exception 'Retention must be between 0 and 15768000 minutes (30 years)';
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
