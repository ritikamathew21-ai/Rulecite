-- Organisation-scoped access. Clients get only the grants below.
-- The audit log has no client write path, so entries cannot be forged.

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- security definer lets policies read memberships without re-triggering its own policies.
create function private.is_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = target_org
      and m.user_id = (select auth.uid())
  );
$$;

create function private.has_role(target_org uuid, allowed public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = target_org
      and m.user_id = (select auth.uid())
      and m.role = any (allowed)
  );
$$;

revoke all on function private.is_member(uuid), private.has_role(uuid, public.app_role[]) from public, anon;
grant execute on function private.is_member(uuid), private.has_role(uuid, public.app_role[]) to authenticated;

grant select on table public.organizations, public.memberships, public.audit_log to authenticated;
grant update (name) on table public.organizations to authenticated;
grant update (role) on table public.memberships to authenticated;

create policy "Members read their organisation"
  on public.organizations for select to authenticated
  using (private.is_member(id));

create policy "Admins rename their organisation"
  on public.organizations for update to authenticated
  using (private.has_role(id, '{admin}'))
  with check (private.has_role(id, '{admin}'));

create policy "Members read their organisation's memberships"
  on public.memberships for select to authenticated
  using (private.is_member(org_id));

-- Admins cannot change their own role, so an organisation cannot lose its last admin this way.
create policy "Admins change other members' roles"
  on public.memberships for update to authenticated
  using (private.has_role(org_id, '{admin}') and user_id <> (select auth.uid()))
  with check (private.has_role(org_id, '{admin}') and user_id <> (select auth.uid()));

create policy "Reviewers and admins read the audit log"
  on public.audit_log for select to authenticated
  using (private.has_role(org_id, '{reviewer,admin}'));
