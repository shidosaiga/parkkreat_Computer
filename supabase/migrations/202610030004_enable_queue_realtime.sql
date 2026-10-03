do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'queue_requests'
  ) then
    alter publication supabase_realtime add table public.queue_requests;
  end if;
end;
$$;
