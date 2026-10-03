alter table public.queue_requests
  add column if not exists cancelled_at timestamptz;

-- Start the test retention period from migration time for rows already cancelled.
update public.queue_requests
set cancelled_at = now()
where status = 'CANCEL'
  and cancelled_at is null;

create index if not exists queue_requests_cancelled_at_idx
  on public.queue_requests (cancelled_at)
  where status = 'CANCEL';

create or replace function public.set_queue_request_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();

  if new.status = 'CANCEL' then
    if tg_op = 'INSERT' or old.status is distinct from 'CANCEL' then
      new.cancelled_at = now();
    end if;
  else
    new.cancelled_at = null;
  end if;

  return new;
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'cleanup-cancelled-queue'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'cleanup-cancelled-queue',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://solquuycchhumpyrsppr.supabase.co/functions/v1/cleanup-cancelled-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_KmQRCmBQLn6oAey_DEBJPg_DgI-Yi2a'
      ),
      body := '{}'::jsonb
    );
  $job$
);
