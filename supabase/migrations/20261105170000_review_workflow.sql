-- The human review workflow: decisions, versions, comments, submission and approval.
-- Every step is a checked function, so clients still have no direct write access.

alter table public.findings
  add column replacement text check (char_length(replacement) <= 2000),
  add column resolution text check (char_length(resolution) <= 2000);

alter table public.documents
  add column approved_version_id uuid references public.document_versions (id) on delete set null,
  add column approved_by uuid,
  add column approved_at timestamptz;

create index documents_approved_version_id_idx on public.documents (approved_version_id);

create table public.finding_decisions (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid not null,
  action text not null check (action in ('accepted', 'edited', 'dismissed')),
  reason_code text check (reason_code in ('false_positive', 'rule_unclear', 'intentional_exception', 'other')),
  reason_text text check (char_length(reason_text) <= 1000),
  final_text text check (char_length(final_text) <= 2000),
  created_at timestamptz not null default now()
);

create index finding_decisions_finding_id_idx on public.finding_decisions (finding_id);
create index finding_decisions_document_id_idx on public.finding_decisions (document_id);
create index finding_decisions_org_id_idx on public.finding_decisions (org_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version_id uuid not null references public.document_versions (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  author_id uuid not null,
  author_name text not null check (char_length(author_name) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index comments_document_id_idx on public.comments (document_id);
create index comments_version_id_idx on public.comments (version_id);
create index comments_org_id_idx on public.comments (org_id);

create function private.latest_version(target_document uuid)
returns public.document_versions
language sql
stable
security definer
set search_path = ''
as $$
  select v.*
  from public.document_versions v
  where v.document_id = target_document
  order by v.number desc
  limit 1;
$$;

create function private.latest_run(target_version uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.check_runs r
  where r.version_id = target_version
  order by r.created_at desc
  limit 1;
$$;

revoke all on function private.latest_version(uuid), private.latest_run(uuid) from public, anon, authenticated;

create or replace function public.record_check_run(
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
    rule_id, rule_version, explanation, suggestion, replacement, citation
  )
  select
    new_run, version_row.document_id, version_row.id, version_row.org_id, f.origin, f.category,
    f.severity::public.rule_severity, f.quote, f.start_offset, f.end_offset,
    f.rule_id, f.rule_version, f.explanation, f.suggestion, f.replacement, f.citation
  from jsonb_to_recordset(p_findings) as f (
    origin text, category text, severity text, quote text, start_offset integer, end_offset integer,
    rule_id uuid, rule_version integer, explanation text, suggestion text, replacement text, citation jsonb
  );

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    version_row.org_id, auth.uid(), 'check.' || p_status, 'document', version_row.document_id::text,
    jsonb_build_object('run_id', new_run, 'failure_reason', p_failure_reason)
  );

  return new_run;
end;
$$;

create function public.decide_finding(
  p_finding_id uuid,
  p_action text,
  p_reason_code text,
  p_reason_text text,
  p_final_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  finding_row public.findings;
  document_row public.documents;
begin
  select * into finding_row from public.findings where id = p_finding_id;
  if found then
    select * into document_row from public.documents where id = finding_row.document_id;
  end if;

  -- A hidden finding looks the same as a missing one.
  if not found or document_row.created_by is distinct from actor or not private.is_member(document_row.org_id) then
    raise exception 'Only the author can decide findings' using errcode = '42501';
  end if;

  if document_row.status not in ('draft', 'changes_requested') then
    raise exception 'This document is not open for decisions' using errcode = '55000';
  end if;

  if finding_row.run_id is distinct from private.latest_run((private.latest_version(document_row.id)).id) then
    raise exception 'This finding is out of date' using errcode = '55000';
  end if;

  if p_action = 'edited' and (nullif(btrim(p_final_text), '') is null or finding_row.quote is null) then
    raise exception 'An edit needs replacement text for a quoted finding' using errcode = '22023';
  end if;

  if p_action = 'dismissed' and (
    p_reason_code is null or (p_reason_code = 'other' and nullif(btrim(p_reason_text), '') is null)
  ) then
    raise exception 'A dismissal needs a reason' using errcode = '22023';
  end if;

  insert into public.finding_decisions (
    finding_id, document_id, org_id, actor_id, action, reason_code, reason_text, final_text
  )
  values (
    finding_row.id, finding_row.document_id, finding_row.org_id, actor, p_action,
    case when p_action = 'dismissed' then p_reason_code end,
    case when p_action = 'dismissed' then p_reason_text end,
    case when p_action = 'edited' then p_final_text end
  );

  update public.findings
  set state = p_action, resolution = case when p_action = 'edited' then p_final_text end
  where id = finding_row.id;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    finding_row.org_id, actor, 'finding.' || p_action, 'finding', finding_row.id::text,
    jsonb_build_object(
      'document_id', finding_row.document_id,
      'rule_code', finding_row.citation ->> 'code',
      'reason_code', case when p_action = 'dismissed' then p_reason_code end
    )
  );
end;
$$;

create function public.add_document_version(
  p_document_id uuid,
  p_expected_number integer,
  p_text text,
  p_synthetic boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document_row public.documents;
  latest public.document_versions;
  new_version uuid;
begin
  select * into document_row from public.documents where id = p_document_id for update;
  if not found or document_row.created_by is distinct from actor or not private.is_member(document_row.org_id) then
    raise exception 'Only the author can add a version' using errcode = '42501';
  end if;

  if document_row.status = 'in_review' then
    raise exception 'This document is in review' using errcode = '55000';
  end if;

  latest = private.latest_version(p_document_id);
  if latest.number is distinct from p_expected_number then
    raise exception 'This document changed' using errcode = '55000';
  end if;

  insert into public.document_versions (
    document_id, org_id, number, source_type, plain_text, images, colours,
    synthetic_confirmed_by, synthetic_confirmed_at, created_by
  )
  values (
    p_document_id, latest.org_id, latest.number + 1, latest.source_type, p_text, latest.images, latest.colours,
    case when p_synthetic then actor end,
    case when p_synthetic then now() end,
    actor
  )
  returning id into new_version;

  update public.documents
  set status = 'draft', approved_version_id = null, approved_by = null, approved_at = null, updated_at = now()
  where id = p_document_id;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    latest.org_id, actor, 'document.version_added', 'document', p_document_id::text,
    jsonb_build_object('version', latest.number + 1)
  );

  return new_version;
end;
$$;

create function public.submit_document(p_document_id uuid, p_expected_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document_row public.documents;
  latest public.document_versions;
  run uuid;
begin
  select * into document_row from public.documents where id = p_document_id for update;
  if not found or document_row.created_by is distinct from actor or not private.is_member(document_row.org_id) then
    raise exception 'Only the author can submit' using errcode = '42501';
  end if;

  if document_row.status not in ('draft', 'changes_requested') then
    raise exception 'This document cannot be submitted now' using errcode = '55000';
  end if;

  latest = private.latest_version(p_document_id);
  if latest.number is distinct from p_expected_number then
    raise exception 'This document changed' using errcode = '55000';
  end if;

  run = private.latest_run(latest.id);
  if run is null then
    raise exception 'This version has not been checked' using errcode = '55000';
  end if;

  if exists (select 1 from public.findings f where f.run_id = run and f.severity = 'high' and f.state = 'open') then
    raise exception 'High severity findings need a decision' using errcode = '55000';
  end if;

  update public.documents set status = 'in_review', updated_at = now() where id = p_document_id;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    latest.org_id, actor, 'document.submitted', 'document', p_document_id::text,
    jsonb_build_object('version', latest.number)
  );
end;
$$;

create function public.review_document(
  p_document_id uuid,
  p_expected_number integer,
  p_decision text,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document_row public.documents;
  latest public.document_versions;
begin
  select * into document_row from public.documents where id = p_document_id for update;
  if not found or not private.has_role(document_row.org_id, '{reviewer,admin}') then
    raise exception 'Only a Reviewer or Admin can review' using errcode = '42501';
  end if;

  if document_row.created_by = actor then
    raise exception 'You cannot review your own document' using errcode = '42501';
  end if;

  if document_row.status <> 'in_review' then
    raise exception 'This document is not in review' using errcode = '55000';
  end if;

  latest = private.latest_version(p_document_id);
  if latest.number is distinct from p_expected_number then
    raise exception 'This document changed' using errcode = '55000';
  end if;

  if p_decision = 'approved' then
    update public.documents
    set status = 'approved', approved_version_id = latest.id, approved_by = actor, approved_at = now(), updated_at = now()
    where id = p_document_id;
  elsif p_decision = 'changes_requested' then
    if nullif(btrim(p_comment), '') is null then
      raise exception 'Requesting changes needs a comment' using errcode = '22023';
    end if;
    update public.documents set status = 'changes_requested', updated_at = now() where id = p_document_id;
  else
    raise exception 'Unknown review decision' using errcode = '22023';
  end if;

  if nullif(btrim(p_comment), '') is not null then
    insert into public.comments (document_id, version_id, org_id, author_id, author_name, body)
    values (
      p_document_id, latest.id, latest.org_id, actor,
      coalesce(auth.jwt() -> 'user_metadata' ->> 'name', auth.jwt() ->> 'email', 'Reviewer'),
      p_comment
    );
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    latest.org_id, actor, 'document.' || p_decision, 'document', p_document_id::text,
    jsonb_build_object('version', latest.number)
  );
end;
$$;

create function public.add_comment(p_document_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  latest public.document_versions;
begin
  if actor is null or not private.can_read_document(p_document_id) then
    raise exception 'You cannot comment on this document' using errcode = '42501';
  end if;

  latest = private.latest_version(p_document_id);

  insert into public.comments (document_id, version_id, org_id, author_id, author_name, body)
  values (
    p_document_id, latest.id, latest.org_id, actor,
    coalesce(auth.jwt() -> 'user_metadata' ->> 'name', auth.jwt() ->> 'email', 'Team member'),
    p_body
  );

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (latest.org_id, actor, 'comment.added', 'document', p_document_id::text, jsonb_build_object('version', latest.number));
end;
$$;

revoke all on function
  public.decide_finding(uuid, text, text, text, text),
  public.add_document_version(uuid, integer, text, boolean),
  public.submit_document(uuid, integer),
  public.review_document(uuid, integer, text, text),
  public.add_comment(uuid, text)
from public, anon;

grant execute on function
  public.decide_finding(uuid, text, text, text, text),
  public.add_document_version(uuid, integer, text, boolean),
  public.submit_document(uuid, integer),
  public.review_document(uuid, integer, text, text),
  public.add_comment(uuid, text)
to authenticated;

alter table public.finding_decisions enable row level security;
alter table public.comments enable row level security;

revoke all on table public.finding_decisions, public.comments from anon, authenticated;
grant select on table public.finding_decisions, public.comments to authenticated;

create policy "Authors, reviewers and admins read decisions"
  on public.finding_decisions for select to authenticated
  using (private.can_read_document(document_id));

create policy "Authors, reviewers and admins read comments"
  on public.comments for select to authenticated
  using (private.can_read_document(document_id));

notify pgrst, 'reload schema';
