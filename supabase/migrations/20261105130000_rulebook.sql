-- The Rulebook: versioned rules that cite their source, approved by an Admin.
-- Triggers own versions, approval details, revisions and audit entries, so clients cannot forge them.

create type public.rule_type as enum (
  'tone', 'terminology', 'banned_phrase', 'messaging', 'claim', 'readability', 'accessibility', 'visual'
);
create type public.rule_severity as enum ('low', 'medium', 'high');
create type public.rule_status as enum ('draft', 'approved', 'retired');

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Z]{2,6}-[0-9]{2,4}$'),
  type public.rule_type not null,
  severity public.rule_severity not null default 'medium',
  title text not null check (char_length(btrim(title)) between 1 and 120),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 1000),
  source_excerpt text not null check (char_length(btrim(source_excerpt)) between 1 and 2000),
  source_name text not null check (char_length(btrim(source_name)) between 1 and 200),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  status public.rule_status not null default 'draft',
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create index rules_org_id_status_idx on public.rules (org_id, status);

create table public.rule_revisions (
  rule_id uuid not null references public.rules (id) on delete cascade,
  version integer not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  snapshot jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now(),
  primary key (rule_id, version)
);

create index rule_revisions_org_id_idx on public.rule_revisions (org_id);

create function public.prepare_rule_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
    return new;
  end if;

  new.updated_at = now();

  if (new.type, new.severity, new.title, new.instruction, new.source_excerpt, new.source_name, new.config)
     is distinct from
     (old.type, old.severity, old.title, old.instruction, old.source_excerpt, old.source_name, old.config) then
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

create function public.record_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.rule_revisions (rule_id, version, org_id, snapshot, changed_by)
    values (new.id, new.version, new.org_id, to_jsonb(new), auth.uid());
  end if;

  audit_action = case
    when tg_op = 'INSERT' then 'rule.created'
    when new.version <> old.version then 'rule.edited'
    when new.status is distinct from old.status then 'rule.' || new.status
  end;

  if audit_action is not null then
    insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      new.org_id,
      auth.uid(),
      audit_action,
      'rule',
      new.code,
      jsonb_build_object('rule_id', new.id, 'version', new.version, 'status', new.status)
    );
  end if;

  return null;
end;
$$;

create trigger rules_prepare_change
  before insert or update on public.rules
  for each row execute function public.prepare_rule_change();

create trigger rules_record_change
  after insert or update on public.rules
  for each row execute function public.record_rule_change();

alter table public.rules enable row level security;
alter table public.rule_revisions enable row level security;

revoke all on table public.rules, public.rule_revisions from anon, authenticated;
revoke all on function public.prepare_rule_change(), public.record_rule_change() from public, anon, authenticated;

grant select on table public.rules, public.rule_revisions to authenticated;
grant insert (org_id, code, type, severity, title, instruction, source_excerpt, source_name, config)
  on table public.rules to authenticated;
grant update (type, severity, title, instruction, source_excerpt, source_name, config, status)
  on table public.rules to authenticated;

create policy "Members read approved rules, reviewers and admins read all"
  on public.rules for select to authenticated
  using (
    private.is_member(org_id)
    and (status = 'approved' or private.has_role(org_id, '{reviewer,admin}'))
  );

create policy "Admins add rules"
  on public.rules for insert to authenticated
  with check (private.has_role(org_id, '{admin}'));

create policy "Admins change rules"
  on public.rules for update to authenticated
  using (private.has_role(org_id, '{admin}'))
  with check (private.has_role(org_id, '{admin}'));

create policy "Reviewers and admins read rule history"
  on public.rule_revisions for select to authenticated
  using (private.has_role(org_id, '{reviewer,admin}'));
