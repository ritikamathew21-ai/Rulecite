# Recovering from a failed demo seed

`npm run db:seed` never deletes or repairs anything. If it fails, it stops and prints a report. Keep that report, because it holds the exact IDs this procedure needs.

```text
SEED FAILED at: Create organisation
Reason: Could not create the organisation (PGRST301)
Completed before the failure: Create account vornelle-creator@example.com; ...
Created accounts: vornelle-creator@example.com = 1111...; ...
Created organisation: none
Recovery case: A
```

## Rules for every case

- Do not rerun the seed until the records are gone. It refuses while any exist.
- Do not touch `audit_log`. It is append-only, and the database rejects changes.
- Do not touch any organisation other than the reported `<ORG_ID>`, or any account other than the reported IDs. Never delete by a name pattern.
- Run every cleanup step by hand, after the project owner approves it. No script does this.
- Once any audit row exists, keep the organisation and accounts. Deleting the Demo Admin would remove the person those audit rows point to.
- Stop and ask if what you find does not match the report.

## Step 1: check what exists

Run these read-only queries in the Supabase SQL editor. The report can be incomplete if a response was lost after the server saved a record, so trust these results over the report.

```sql
select id, name, is_demo, created_at
from public.organizations
where name ilike '%vornelle%';
```

```sql
select id, email, created_at
from auth.users
where email in (
  'vornelle-creator@example.com',
  'vornelle-reviewer@example.com',
  'vornelle-admin@example.com'
);
```

If an organisation exists, also run these with its ID:

```sql
select action, count(*)
from public.audit_log
where org_id = '<ORG_ID>'
group by action
order by action;
```

```sql
select 'memberships' as records, null::text as status, count(*) from public.memberships where org_id = '<ORG_ID>'
union all select 'rules', status::text, count(*) from public.rules where org_id = '<ORG_ID>' group by status
union all select 'facts', status::text, count(*) from public.facts where org_id = '<ORG_ID>' group by status
union all select 'assets', status::text, count(*) from public.assets where org_id = '<ORG_ID>' group by status;
```

A complete seed has 3 memberships, 11 approved and 1 draft rules, 5 approved and 1 draft facts, 4 approved and 1 draft colours, and 43 audit rows.

## Step 2: choose the case

| Found | Case | Outcome |
|---|---|---|
| Accounts only, no organisation | A | Clean up and rerun |
| Organisation, no audit rows | B | Clean up and rerun |
| Organisation with audit rows | C | Finish in the app, or leave it unused |
| Everything written, but verification failed | D | Investigate before changing anything |

The report suggests a case. If Step 1 disagrees, use the case from this table.

## Case A: accounts only

Accounts on their own have no audit rows and no membership. They can sign in, but they only reach the no-access page.

1. In Supabase, open **Authentication**, then **Users**.
2. Delete only the accounts whose IDs match the report and Step 1.
3. Repeat the accounts query, and confirm it returns no rows.
4. Rerun the seed, if approved.

## Case B: organisation with no audit rows

Memberships and an empty organisation create no audit rows. Confirm the audit query returned no rows first.

1. Delete the organisation by its exact ID. This also removes its memberships.

   ```sql
   delete from public.organizations
   where id = '<ORG_ID>' and name = 'Vornelle (Fictional Demo)';
   ```

2. Delete the accounts, as in Case A.
3. Repeat the Step 1 queries, and confirm they return no rows.
4. Rerun the seed, if approved.

If the delete is refused, audit rows exist, so treat it as Case C.

## Case C: organisation with audit rows

The audit rows are permanent, and they block deleting the organisation. Do not delete the rules, facts, colours or accounts either. There are two safe options.

**Option 1: finish in the app.**

1. Sign in as `vornelle-admin@example.com`.
2. Approve anything still in draft on the Rulebook, Claim Ledger and Assets pages, except `MSG-09`, `FACT-06` and `CLR-05`, which stay as drafts.
3. If a whole group is missing, add it with the values in `scripts/seed-demo.mjs`, then approve it.
4. Repeat the Step 1 queries, and compare them with the complete seed above.

The `.approved` audit rows match a normal seed. Anything added by hand has a `.created` audit row with the Demo Admin as the actor, where the seed would have none. That difference is accurate and should stay.

**Option 2: leave it unused.**

Keep the records, do not share the logins, and keep using the existing demo. The seed will keep refusing, so using the name Vornelle again is not possible. Blocking those accounts from signing in would be a separate, approved step.

## Case D: verification failed

All stages finished, but the read-back found a difference. The reason lists what was expected and what was found.

1. Change nothing.
2. Run the Step 1 queries.
3. If only approvals are missing, follow Case C, Option 1.
4. If the read itself failed and the counts are complete, the seed worked, so record that.
5. For anything else, such as a duplicate organisation, stop and review it. A duplicate means two runs overlapped, so report both organisation IDs.

## Other organisations

Record each organisation's row counts before seeding, and compare them afterwards:

```sql
select o.name,
  (select count(*) from public.memberships x where x.org_id = o.id) as memberships,
  (select count(*) from public.rules x where x.org_id = o.id) as rules,
  (select count(*) from public.facts x where x.org_id = o.id) as facts,
  (select count(*) from public.assets x where x.org_id = o.id) as assets,
  (select count(*) from public.audit_log x where x.org_id = o.id) as audit_rows
from public.organizations o
where o.name not ilike '%vornelle%'
order by o.name;
```

Tests or people using the app can change these counts between readings, so look into a difference before assuming the seed caused it.

## Stale lock

If the process was killed, the report may not appear, and the lock file can remain. Confirm no seed is running, then delete `rulecite-seed-demo.lock` from the system temp folder. Then start at Step 1, because the run may have written records.
