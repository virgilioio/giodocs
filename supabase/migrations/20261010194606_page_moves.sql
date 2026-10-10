-- Moving pages in the tree (Allan, 2026-10-10): drag a page in the sidebar
-- to reorder it among its siblings or to place it inside another page.
--
-- pages.position is the order among siblings (smaller first). Pages that
-- were never ordered have none and sort after the ordered ones, newest
-- edit first, as the tree did before.
--
-- move_page is the one way a page changes place or order. It checks that
-- the person can edit the page and the page it goes into, keeps the cycle
-- guard (guard_page_parent), and handles databases: into a database the
-- page becomes a row; out of one it becomes a plain page with no
-- properties; between databases a value carries over to the property with
-- the same name and type, when the value is legal there. It returns where
-- the page was (parent, the sibling after it, its properties), which is
-- what Undo passes back.

alter table public.pages
  add column if not exists position double precision;

create index if not exists pages_parent_position_idx
  on public.pages (workspace_id, parent_id, position) where deleted_at is null;

create or replace function public.move_page(
  p_page uuid,
  p_parent uuid,
  p_before uuid default null,
  p_props jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me public.pages;
  par public.pages;
  new_db uuid;
  old_before uuid;
  next_props jsonb;
  k text;
  v jsonb;
  od public.property_defs;
  nd public.property_defs;
  ord uuid[];
  i int;
begin
  select * into me from public.pages where id = p_page and deleted_at is null for update;
  if me.id is null or not public.is_member(me.workspace_id) then
    raise exception 'That page is no longer there.' using errcode = 'P0002';
  end if;
  if not public.can_edit_page_row(me) then
    raise exception 'You can view this page but not move it.' using errcode = '42501';
  end if;

  if p_parent is not null then
    select * into par from public.pages where id = p_parent and deleted_at is null;
    if par.id is null or par.workspace_id <> me.workspace_id then
      raise exception 'That page is no longer there.' using errcode = 'P0002';
    end if;
    if not public.can_edit_page_row(par) then
      raise exception 'You can''t add pages inside "%".', coalesce(nullif(par.title, ''), 'Untitled')
        using errcode = '42501';
    end if;
    new_db := case when par.is_database then par.id else null end;
  end if;

  -- Where it was, for Undo: the sibling that came right after it.
  select array_agg(s.id order by s.position nulls last, s.edited_at desc, s.id) into ord
    from public.pages s
   where s.workspace_id = me.workspace_id
     and s.parent_id is not distinct from me.parent_id
     and s.deleted_at is null;
  i := array_position(ord, me.id);
  old_before := case when i is null then null else ord[i + 1] end;

  -- Properties: kept within the same database, carried over by name and
  -- type into another, none on a plain page. Undo passes them back as is.
  if p_props is not null then
    next_props := p_props;
  elsif new_db is not distinct from me.database_id then
    next_props := me.props;
  elsif new_db is null then
    next_props := '{}'::jsonb;
  else
    next_props := '{}'::jsonb;
    for k, v in select key, value from jsonb_each(me.props) loop
      if v = 'null'::jsonb then continue; end if;
      select * into od from public.property_defs
       where database_id = me.database_id and key = k;
      if od.id is null
         or od.type::text not in ('text', 'number', 'date', 'checkbox', 'url', 'email',
                                  'phone', 'person', 'select', 'status', 'multi_select') then
        continue;
      end if;
      select * into nd from public.property_defs
       where database_id = new_db and archived_at is null
         and type = od.type and lower(label) = lower(od.label)
       order by position limit 1;
      if nd.id is null then continue; end if;
      if nd.type::text in ('select', 'status')
         and not (nd.type::text = 'select' and nd.open_values)
         and jsonb_array_length(nd.options) > 0
         and not (nd.options @> jsonb_build_array(jsonb_build_object('value', v #>> '{}'))) then
        continue;
      end if;
      next_props := next_props || jsonb_build_object(nd.key, v);
    end loop;
  end if;

  update public.pages
     set parent_id = p_parent,
         props = next_props
   where id = me.id;

  -- Order among the new siblings: renumber them in their current order with
  -- this page placed before p_before (or last). Only position changes on
  -- the siblings, which isn't an edit of them.
  select array_agg(s.id order by s.position nulls last, s.edited_at desc, s.id) into ord
    from public.pages s
   where s.workspace_id = me.workspace_id
     and s.parent_id is not distinct from p_parent
     and s.deleted_at is null
     and s.id <> me.id;
  ord := coalesce(ord, '{}'::uuid[]);
  i := case when p_before is null then 0 else array_position(ord, p_before) end;
  if i is null or i = 0 then
    ord := ord || me.id;
  else
    ord := ord[1:i - 1] || me.id || ord[i:];
  end if;
  update public.pages s
     set position = x.n
    from unnest(ord) with ordinality as x(id, n)
   where s.id = x.id and s.position is distinct from x.n;

  return jsonb_build_object(
    'parent_id', me.parent_id,
    'before', old_before,
    'props', me.props
  );
end $function$;

revoke all on function public.move_page(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.move_page(uuid, uuid, uuid, jsonb) to authenticated;
