-- Organisations, memberships and the audit log.
-- Every table starts with row-level security on and all client access revoked.
-- Access policies are added by a later migration.

create type public.app_role as enum ('creator', 'reviewer', 'admin');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function public.reject_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  is_demo boolean not null default false,
  daily_check_limit integer not null default 50 check (daily_check_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-- actor_id has no foreign key, so the record of who acted outlives the account.
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete restrict,
  actor_id uuid,
  action text not null check (char_length(btrim(action)) between 1 and 100),
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 100),
  entity_id text,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_log_org_id_created_at_idx on public.audit_log (org_id, created_at desc);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

create trigger audit_log_reject_change
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_change();

create trigger audit_log_reject_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_audit_change();

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;

revoke all on table public.organizations, public.memberships, public.audit_log from anon, authenticated;
revoke all on function public.set_updated_at(), public.reject_audit_change() from public, anon, authenticated;
