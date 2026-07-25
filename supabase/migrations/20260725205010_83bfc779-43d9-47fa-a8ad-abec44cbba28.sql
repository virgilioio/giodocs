-- Seed Allan's three personal views, grant him access to the restricted Hiring page,
-- and absorb the edited_at spread + Recently edited window that previously lived only
-- in direct SQL. Idempotent.

insert into public.views (id, workspace_id, owner_id, name, scope, layout, filter, sort, position)
values
  ('a11a0000-0000-4000-8000-0000000000b1',
   '11111111-1111-1111-1111-111111111111',
   'a11a0000-0000-4000-8000-000000000001',
   'Assigned to me', 'personal', 'table',
   '[{"op":"is_me","prop":"owner"}]'::jsonb,
   '{"prop":"edited","dir":"desc"}'::jsonb, 0),
  ('a11a0000-0000-4000-8000-0000000000b2',
   '11111111-1111-1111-1111-111111111111',
   'a11a0000-0000-4000-8000-000000000001',
   'Needs review', 'personal', 'table',
   '[{"op":"stale","prop":"verified"}]'::jsonb,
   '{"prop":"verified","dir":"asc"}'::jsonb, 1),
  ('a11a0000-0000-4000-8000-0000000000b3',
   '11111111-1111-1111-1111-111111111111',
   'a11a0000-0000-4000-8000-000000000001',
   'Recently edited', 'personal', 'table',
   '[{"op":"edited_within","prop":"edited","value":30}]'::jsonb,
   '{"prop":"edited","dir":"desc"}'::jsonb, 2)
on conflict (id) do nothing;

insert into public.page_access (page_id, user_id, capability)
select p.id, 'a11a0000-0000-4000-8000-000000000001', 'write'
  from public.pages p
 where p.title = 'Compensation bands' and p.deleted_at is null
on conflict do nothing;

with spread as (
  select id, row_number() over (order by md5(id::text)) as rn
    from public.pages where deleted_at is null
)
update public.pages p
   set edited_at = now() - ((spread.rn * 2.7)::int || ' days')::interval
  from spread where p.id = spread.id;

update public.pages p
   set verified_at = p.edited_at + interval '1 day'
 where p.verified_at > now() - interval '90 days'
   and p.verified_at < p.edited_at;

update public.views
   set filter = '[{"op":"edited_within","prop":"edited","value":30}]'::jsonb
 where name = 'Recently edited';
