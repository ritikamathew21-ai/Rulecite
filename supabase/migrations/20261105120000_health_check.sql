-- Lets the public health endpoint confirm the database answers.
-- It reads no tables and returns no data.

create function public.health_check()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated;

notify pgrst, 'reload schema';
