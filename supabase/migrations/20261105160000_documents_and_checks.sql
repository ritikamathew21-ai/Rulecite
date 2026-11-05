-- Documents, versions, check runs and findings.
-- Clients have no direct write access. Documents are created through create_document(),
-- and check results can only be recorded by a caller holding the writer secret, so a
-- user cannot record a fake clean run through the API.

alter type public.rule_type add value if not exists 'contrast';

create type public.document_status as enum ('draft', 'in_review', 'changes_requested', 'approved');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status public.document_status not null default 'draft',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_org_id_created_at_idx on public.documents (org_id, created_at desc);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  number integer not null check (number >= 1),
  source_type text not null check (source_type in ('text', 'docx')),
  plain_text text not null check (char_length(plain_text) between 1 and 50000),
  images jsonb not null default '[]' check (jsonb_typeof(images) = 'array'),
  colours jsonb not null default '[]' check (jsonb_typeof(colours) = 'array'),
  synthetic_confirmed_by uuid,
  synthetic_confirmed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (document_id, number)
);

create index document_versions_org_id_idx on public.document_versions (org_id);

create table public.check_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version_id uuid not null references public.document_versions (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null check (status in ('complete', 'partial', 'failed')),
  failure_reason text check (char_length(failure_reason) <= 50),
  provider text check (char_length(provider) <= 50),
  model text check (char_length(model) <= 100),
  dropped_count integer not null default 0 check (dropped_count >= 0),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index check_runs_version_id_created_at_idx on public.check_runs (version_id, created_at desc);
create index check_runs_document_id_idx on public.check_runs (document_id);
create index check_runs_org_id_idx on public.check_runs (org_id);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.check_runs (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  version_id uuid not null references public.document_versions (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  origin text not null check (origin in ('rule', 'ai')),
  category text not null check (char_length(category) <= 50),
  severity public.rule_severity not null,
  quote text check (char_length(quote) <= 2000),
  start_offset integer check (start_offset >= 0),
  end_offset integer,
  rule_id uuid references public.rules (id) on delete set null,
  rule_version integer,
  explanation text not null check (char_length(explanation) between 1 and 2000),
  suggestion text not null check (char_length(suggestion) between 1 and 2000),
  citation jsonb not null check (jsonb_typeof(citation) = 'object'),
  state text not null default 'open' check (state in ('open', 'accepted', 'edited', 'dismissed')),
  created_at timestamptz not null default now(),
  check ((start_offset is null) = (end_offset is null)),
  check (end_offset is null or end_offset > start_offset)
);

create index findings_run_id_idx on public.findings (run_id);
create index findings_document_id_idx on public.findings (document_id);
create index findings_version_id_idx on public.findings (version_id);
create index findings_org_id_idx on public.findings (org_id);
create index findings_rule_id_idx on public.findings (rule_id);

create table private.check_writer (
  id boolean primary key default true check (id),
  secret_hash bytea not null
);

revoke all on table private.check_writer from public, anon, authenticated;

create function private.can_read_document(target_document uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = target_document
      and (
        (d.created_by = (select auth.uid()) and private.is_member(d.org_id))
        or private.has_role(d.org_id, '{reviewer,admin}')
      )
  );
$$;

revoke all on function private.can_read_document(uuid) from public, anon;
grant execute on function private.can_read_document(uuid) to authenticated;

create function public.create_document(
  p_org_id uuid,
  p_title text,
  p_source_type text,
  p_text text,
  p_images jsonb,
  p_colours jsonb,
  p_synthetic boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  new_document uuid;
  new_version uuid;
begin
  if actor is null or not private.is_member(p_org_id) then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;

  insert into public.documents (org_id, title, created_by)
  values (p_org_id, p_title, actor)
  returning id into new_document;

  insert into public.document_versions (
    document_id, org_id, number, source_type, plain_text, images, colours,
    synthetic_confirmed_by, synthetic_confirmed_at, created_by
  )
  values (
    new_document, p_org_id, 1, p_source_type, p_text, p_images, p_colours,
    case when p_synthetic then actor end,
    case when p_synthetic then now() end,
    actor
  )
  returning id into new_version;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org_id, actor, 'document.created', 'document', new_document::text, jsonb_build_object('version', 1));

  return jsonb_build_object('document_id', new_document, 'version_id', new_version);
end;
$$;

create function public.record_check_run(
  p_secret text,
  p_version_id uuid,
  p_status text,
  p_failure_reason text,
  p_provider text,
  p_model text,
  p_dropped_count integer,
  p_findings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.document_versions;
  new_run uuid;
begin
  if not exists (
    select 1 from private.check_writer w
    where w.secret_hash = sha256(convert_to(coalesce(p_secret, ''), 'UTF8'))
  ) then
    raise exception 'Not authorised to record checks' using errcode = '42501';
  end if;

  select * into version_row from public.document_versions where id = p_version_id;
  if not found then
    raise exception 'Unknown document version' using errcode = '23503';
  end if;

  insert into public.check_runs (
    document_id, version_id, org_id, status, failure_reason, provider, model, dropped_count, created_by
  )
  values (
    version_row.document_id, version_row.id, version_row.org_id, p_status, p_failure_reason,
    p_provider, p_model, p_dropped_count, auth.uid()
  )
  returning id into new_run;

  insert into public.findings (
    run_id, document_id, version_id, org_id, origin, category, severity, quote, start_offset, end_offset,
    rule_id, rule_version, explanation, suggestion, citation
  )
  select
    new_run, version_row.document_id, version_row.id, version_row.org_id, f.origin, f.category,
    f.severity::public.rule_severity, f.quote, f.start_offset, f.end_offset,
    f.rule_id, f.rule_version, f.explanation, f.suggestion, f.citation
  from jsonb_to_recordset(p_findings) as f (
    origin text, category text, severity text, quote text, start_offset integer, end_offset integer,
    rule_id uuid, rule_version integer, explanation text, suggestion text, citation jsonb
  );

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    version_row.org_id, auth.uid(), 'check.' || p_status, 'document', version_row.document_id::text,
    jsonb_build_object('run_id', new_run, 'failure_reason', p_failure_reason)
  );

  return new_run;
end;
$$;

revoke all on function public.create_document(uuid, text, text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.create_document(uuid, text, text, text, jsonb, jsonb, boolean) to authenticated;
revoke all on function public.record_check_run(text, uuid, text, text, text, text, integer, jsonb) from public, anon;
grant execute on function public.record_check_run(text, uuid, text, text, text, text, integer, jsonb) to authenticated;

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.check_runs enable row level security;
alter table public.findings enable row level security;

revoke all on table public.documents, public.document_versions, public.check_runs, public.findings
  from anon, authenticated;
grant select on table public.documents, public.document_versions, public.check_runs, public.findings
  to authenticated;

create policy "Authors, reviewers and admins read documents"
  on public.documents for select to authenticated
  using (private.can_read_document(id));

create policy "Authors, reviewers and admins read versions"
  on public.document_versions for select to authenticated
  using (private.can_read_document(document_id));

create policy "Authors, reviewers and admins read check runs"
  on public.check_runs for select to authenticated
  using (private.can_read_document(document_id));

create policy "Authors, reviewers and admins read findings"
  on public.findings for select to authenticated
  using (private.can_read_document(document_id));

notify pgrst, 'reload schema';
