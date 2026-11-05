-- The Claim Ledger and brand colour assets, approved by an Admin.
-- Facts are versioned like rules. Assets are immutable: retire one and add a replacement.
-- Expiry is compared with the date when needed, so it is never stored as a status.

create table public.facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Z]{2,6}-[0-9]{2,4}$'),
  statement text not null check (char_length(btrim(statement)) between 1 and 1000),
  source_name text not null check (char_length(btrim(source_name)) between 1 and 200),
  source_url text check (source_url ~ '^https?://' and char_length(source_url) <= 500),
  valid_from date not null default current_date,
  expires_on date,
  status public.rule_status not null default 'draft',
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code),
  check (expires_on is null or expires_on >= valid_from)
);

create index facts_org_id_status_idx on public.facts (org_id, status);

create table public.fact_revisions (
  fact_id uuid not null references public.facts (id) on delete cascade,
  version integer not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  snapshot jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now(),
  primary key (fact_id, version)
);

create index fact_revisions_org_id_idx on public.fact_revisions (org_id);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Z]{2,6}-[0-9]{2,4}$'),
  kind text not null default 'colour' check (kind in ('colour')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  value text not null check (value ~ '^#[0-9A-F]{6}$'),
  status public.rule_status not null default 'draft',
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create index assets_org_id_status_idx on public.assets (org_id, status);

create function public.prepare_fact_change()
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
    (new.statement, new.source_name, new.source_url, new.valid_from, new.expires_on)
    is distinct from
    (old.statement, old.source_name, old.source_url, old.valid_from, old.expires_on);

  if old.status = 'retired' and (content_changed or new.status = 'approved') then
    raise exception 'A retired fact must be restored to draft first' using errcode = '23514';
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

create function public.record_fact_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.fact_revisions (fact_id, version, org_id, snapshot, changed_by)
    values (new.id, new.version, new.org_id, to_jsonb(new), auth.uid());
  end if;

  audit_action = case
    when tg_op = 'INSERT' then 'fact.created'
    when new.version <> old.version then 'fact.edited'
    when new.status is distinct from old.status then 'fact.' || new.status
  end;

  if audit_action is not null then
    insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      new.org_id,
      auth.uid(),
      audit_action,
      'fact',
      new.code,
      jsonb_build_object('fact_id', new.id, 'version', new.version, 'status', new.status)
    );
  end if;

  return null;
end;
$$;

create function public.prepare_asset_change()
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

  if old.status = 'retired' and new.status = 'approved' then
    raise exception 'A retired asset must be restored to draft first' using errcode = '23514';
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

create function public.record_asset_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
begin
  audit_action = case
    when tg_op = 'INSERT' then 'asset.created'
    when new.status is distinct from old.status then 'asset.' || new.status
  end;

  if audit_action is not null then
    insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      new.org_id,
      auth.uid(),
      audit_action,
      'asset',
      new.code,
      jsonb_build_object('asset_id', new.id, 'status', new.status)
    );
  end if;

  return null;
end;
$$;

create trigger facts_prepare_change
  before insert or update on public.facts
  for each row execute function public.prepare_fact_change();

create trigger facts_record_change
  after insert or update on public.facts
  for each row execute function public.record_fact_change();

create trigger assets_prepare_change
  before insert or update on public.assets
  for each row execute function public.prepare_asset_change();

create trigger assets_record_change
  after insert or update on public.assets
  for each row execute function public.record_asset_change();

alter table public.facts enable row level security;
alter table public.fact_revisions enable row level security;
alter table public.assets enable row level security;

revoke all on table public.facts, public.fact_revisions, public.assets from anon, authenticated;
revoke all on function
  public.prepare_fact_change(),
  public.record_fact_change(),
  public.prepare_asset_change(),
  public.record_asset_change()
from public, anon, authenticated;

grant select on table public.facts, public.fact_revisions, public.assets to authenticated;
grant insert (org_id, code, statement, source_name, source_url, valid_from, expires_on)
  on table public.facts to authenticated;
grant update (statement, source_name, source_url, valid_from, expires_on, status)
  on table public.facts to authenticated;
grant insert (org_id, code, name, value) on table public.assets to authenticated;
grant update (status) on table public.assets to authenticated;

create policy "Members read approved facts, reviewers and admins read all"
  on public.facts for select to authenticated
  using (
    private.is_member(org_id)
    and (status = 'approved' or private.has_role(org_id, '{reviewer,admin}'))
  );

create policy "Admins add facts"
  on public.facts for insert to authenticated
  with check (private.has_role(org_id, '{admin}'));

create policy "Admins change facts"
  on public.facts for update to authenticated
  using (private.has_role(org_id, '{admin}'))
  with check (private.has_role(org_id, '{admin}'));

create policy "Reviewers and admins read fact history"
  on public.fact_revisions for select to authenticated
  using (private.has_role(org_id, '{reviewer,admin}'));

create policy "Members read approved assets, reviewers and admins read all"
  on public.assets for select to authenticated
  using (
    private.is_member(org_id)
    and (status = 'approved' or private.has_role(org_id, '{reviewer,admin}'))
  );

create policy "Admins add assets"
  on public.assets for insert to authenticated
  with check (private.has_role(org_id, '{admin}'));

create policy "Admins change asset status"
  on public.assets for update to authenticated
  using (private.has_role(org_id, '{admin}'))
  with check (private.has_role(org_id, '{admin}'));
