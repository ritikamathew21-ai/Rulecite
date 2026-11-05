-- Support for AI checks: claim labels on findings, and a daily limit per organisation.

alter table public.findings
  add column claim_status text check (claim_status in ('unsupported', 'contradicted', 'outdated')),
  add column fact_id uuid references public.facts (id) on delete set null;

create index findings_fact_id_idx on public.findings (fact_id);

create table private.ai_usage (
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  used integer not null default 0 check (used >= 0),
  primary key (org_id, day)
);

revoke all on table private.ai_usage from public, anon, authenticated;

-- One statement, so simultaneous requests cannot pass the limit together.
create function public.reserve_ai_check(p_secret text, p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  daily_limit integer;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  reserved integer;
begin
  if not exists (
    select 1 from private.check_writer w
    where w.secret_hash = sha256(convert_to(coalesce(p_secret, ''), 'UTF8'))
  ) then
    raise exception 'Not authorised to reserve AI checks' using errcode = '42501';
  end if;

  select o.daily_check_limit into daily_limit from public.organizations o where o.id = p_org_id;
  if daily_limit is null or daily_limit <= 0 then
    return false;
  end if;

  insert into private.ai_usage as usage (org_id, day, used)
  values (p_org_id, today, 1)
  on conflict (org_id, day) do update set used = usage.used + 1
  where usage.used < daily_limit
  returning used into reserved;

  return reserved is not null;
end;
$$;

revoke all on function public.reserve_ai_check(text, uuid) from public, anon;
grant execute on function public.reserve_ai_check(text, uuid) to authenticated;

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
    rule_id, rule_version, explanation, suggestion, replacement, citation, claim_status, fact_id
  )
  select
    new_run, version_row.document_id, version_row.id, version_row.org_id, f.origin, f.category,
    f.severity::public.rule_severity, f.quote, f.start_offset, f.end_offset,
    f.rule_id, f.rule_version, f.explanation, f.suggestion, f.replacement, f.citation, f.claim_status, f.fact_id
  from jsonb_to_recordset(p_findings) as f (
    origin text, category text, severity text, quote text, start_offset integer, end_offset integer,
    rule_id uuid, rule_version integer, explanation text, suggestion text, replacement text, citation jsonb,
    claim_status text, fact_id uuid
  );

  insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    version_row.org_id, auth.uid(), 'check.' || p_status, 'document', version_row.document_id::text,
    jsonb_build_object('run_id', new_run, 'failure_reason', p_failure_reason, 'provider', p_provider, 'model', p_model)
  );

  return new_run;
end;
$$;

notify pgrst, 'reload schema';
