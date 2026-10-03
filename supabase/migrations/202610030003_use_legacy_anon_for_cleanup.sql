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
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvbHF1dXljY2hodW1weXJzcHByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDA2NTAsImV4cCI6MjEwNjUxNjY1MH0.os9X2tJHP9znPd6icANsywfzDps7ZyFd6e5OFXjh7u4'
      ),
      body := '{}'::jsonb
    );
  $job$
);