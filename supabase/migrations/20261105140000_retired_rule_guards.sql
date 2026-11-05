-- A retired rule must be restored to draft before it can be changed or approved.

create or replace function public.prepare_rule_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  content_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
    return new;
  end if;

  new.updated_at = now();

  content_changed =
    (new.type, new.severity, new.title, new.instruction, new.source_excerpt, new.source_name, new.config)
    is distinct from
    (old.type, old.severity, old.title, old.instruction, old.source_excerpt, old.source_name, old.config);

  if old.status = 'retired' and (content_changed or new.status = 'approved') then
    raise exception 'A retired rule must be restored to draft first' using errcode = '23514';
  end if;

  if content_changed then
    -- Changed content needs a fresh approval, whatever status was requested.
    new.version = old.version + 1;
    new.status = 'draft';
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_by = auth.uid();
    new.approved_at = now();
  elsif new.status <> 'approved' then
    new.approved_by = null;
    new.approved_at = null;
  end if;

  return new;
end;
$$;

revoke all on function public.prepare_rule_change() from public, anon, authenticated;
