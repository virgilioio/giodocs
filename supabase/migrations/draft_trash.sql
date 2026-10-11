-- Trash (Allan, 2026-10-11; Notion's): deleted pages can be found again
-- and restored, not only through the Undo that follows a delete. Pages
-- RLS hides deleted rows from everyone, so the list comes from this
-- function, read-only:
--   - pages of the caller's workspace with deleted_at set, that the caller
--     could edit (can_edit_page_row: the same people who can delete and
--     restore them);
--   - one row per deletion: a page deleted along with its parent (the same
--     moment) is counted inside the parent, not listed again;
--   - `inside`: how many pages went to the bin with it;
--   - `excerpt`: the first words of its body, so an untitled page can be
--     recognised;
--   - a page thrown away blank (no title, no words, no values, nothing
--     inside — the new-page dialog discards those) isn't listed: there is
--     nothing in it to get back;
--   - where it lived (the parent's title, when there is one) and, when that
--     parent is itself in the bin, the deleted ancestors from the top down,
--     so restoring brings back the place it lives in first.
-- Restoring stays restore_page's job. Nothing here deletes anything.

create or replace function public.list_trash(p_query text default null)
returns table (
  id uuid,
  title text,
  icon text,
  is_database boolean,
  deleted_at timestamptz,
  parent_id uuid,
  parent_title text,
  access_type text,
  excerpt text,
  inside integer,
  trashed_ancestors uuid[]
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  ws uuid;
begin
  select m.workspace_id into ws
    from public.workspace_members m
   where m.user_id = auth.uid()
   limit 1;
  if ws is null then
    return;
  end if;

  return query
  with recursive roots as (
    select p.*
      from public.pages p
      left join public.pages par on par.id = p.parent_id
     where p.workspace_id = ws
       and p.deleted_at is not null
       and p.template_at is null
       and (par.id is null or par.deleted_at is distinct from p.deleted_at)
       and public.can_edit_page_row(p)
       and not (
         coalesce(btrim(p.title), '') = ''
         and not p.is_database
         and coalesce(p.props, '{}'::jsonb) = '{}'::jsonb
         and not exists (
           select 1
             from jsonb_array_elements(
                    case when jsonb_typeof(p.blocks) = 'array' then p.blocks else '[]'::jsonb end
                  ) b
            where jsonb_typeof(b) <> 'object'
               or coalesce(b->>'type', 'text') <> 'text'
               or coalesce(btrim(b->>'text'), '') <> ''
         )
         and not exists (select 1 from public.pages c where c.parent_id = p.id)
       )
       and (p_query is null or btrim(p_query) = ''
            or p.title ilike '%' || btrim(p_query) || '%')
     order by p.deleted_at desc
     limit 200
  ),
  -- The deleted ancestors of each listed page, nearest first.
  up as (
    select r.id as root_id, par.id as anc_id, par.parent_id as next_id, 1 as depth
      from roots r
      join public.pages par on par.id = r.parent_id
     where par.deleted_at is not null
    union all
    select up.root_id, par.id, par.parent_id, up.depth + 1
      from up
      join public.pages par on par.id = up.next_id
     where par.deleted_at is not null
       and up.depth < 50
  )
  select r.id,
         r.title,
         r.icon,
         r.is_database,
         r.deleted_at,
         r.parent_id,
         par.title,
         r.access_type,
         (
           select left(btrim(b->>'text'), 120)
             from jsonb_array_elements(
                    case when jsonb_typeof(r.blocks) = 'array' then r.blocks else '[]'::jsonb end
                  ) b
            where jsonb_typeof(b) = 'object' and coalesce(btrim(b->>'text'), '') <> ''
            limit 1
         ),
         (
           with recursive sub as (
             select c.id from public.pages c
              where c.parent_id = r.id and c.deleted_at = r.deleted_at
             union all
             select c.id from public.pages c join sub on c.parent_id = sub.id
              where c.deleted_at = r.deleted_at
           )
           select count(*)::integer from sub
         ),
         coalesce(
           (select array_agg(up.anc_id order by up.depth desc) from up where up.root_id = r.id),
           '{}'::uuid[]
         )
    from roots r
    left join public.pages par on par.id = r.parent_id
   order by r.deleted_at desc;
end;
$function$;

revoke all on function public.list_trash(text) from public;
grant execute on function public.list_trash(text) to authenticated;
