-- Databases on public pages (Allan, 2026-11-05), the second step of public
-- links. Allan took the recommended answers:
--
-- 1. A database placed on a page the link shows (a view block in the
--    page's own blocks naming one of its child databases, which is what
--    "Table view" makes) is published with the page, every live row
--    included, whatever its sharing: publishing a private page publishes
--    the table it holds. Archived, deleted and template rows never show.
-- 2. Rows open as pages only while the link includes the pages inside it;
--    a row's own sub-pages and databases then follow the same rules.
-- 3. A linked view of a database that lives elsewhere shows only when that
--    database is public through some live link of the workspace; its rows
--    are listed but don't open from this link. Otherwise the visitor reads
--    "This database isn't public".
-- 4. Relations read the titles of pages the visitor may see; rollups are
--    worked out (in the browser) only from those. A related database that
--    is public comes along so they can be.
-- 5. People named in values show by name only (and their avatar colour),
--    never an email.
--
-- get_published_page gains `databases`, `people`, `unavailable` and
-- `stale_days`; page_is_published covers the rows a public view lists, so
-- their files can be signed for visitors. No table policy changes.

-- Do the blocks of p_parent place a view of p_db (at any depth: columns,
-- callouts, toggles)?
create or replace function public.public_places(p_parent uuid, p_db uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.pages p
     where p.id = p_parent
       and jsonb_path_exists(
             coalesce(p.blocks, '[]'::jsonb),
             'lax $.** ? (@.type == "view" && @.view.database_id == $id)',
             jsonb_build_object('id', p_db::text)));
$$;

revoke all on function public.public_places(uuid, uuid) from public, anon, authenticated;

-- Is p_page shown by the link on p_root? It is the root (live), or, with
-- sub-pages included, every step from it up to the root is live and is
-- one of: a sub-page shared with the whole workspace, a row of a database,
-- or a database placed on the page it lives in.
create or replace function public.public_path_ok(p_root uuid, p_include boolean, p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select p.id, p.parent_id, p.access_type::text as access, p.is_database,
           (p.deleted_at is null and p.archived_at is null and p.template_at is null) as live,
           null::boolean as step_ok,
           0 as depth
      from public.pages p
     where p.id = p_page
    union all
    select q.id, q.parent_id, q.access_type::text, q.is_database,
           (q.deleted_at is null and q.archived_at is null and q.template_at is null),
           (c.live and (c.access = 'workspace'
                        or q.is_database
                        or (c.is_database and public.public_places(q.id, c.id)))),
           c.depth + 1
      from public.pages q
      join chain c on q.id = c.parent_id
     where c.depth < 50 and c.id <> p_root
  )
  select exists (select 1 from chain where id = p_root and live)
     and (p_page = p_root
          or (p_include and not exists (
                select 1 from chain where depth > 0 and step_ok is not true)));
$$;

revoke all on function public.public_path_ok(uuid, boolean, uuid) from public, anon, authenticated;

-- May the link on p_root list the rows of p_db? The database is a page it
-- shows, or is placed on one.
create or replace function public.public_db_ok(p_root uuid, p_include boolean, p_db uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.pages d
     where d.id = p_db
       and d.is_database
       and d.deleted_at is null and d.archived_at is null and d.template_at is null
       and (public.public_path_ok(p_root, p_include, d.id)
            or (d.parent_id is not null
                and public.public_places(d.parent_id, d.id)
                and public.public_path_ok(p_root, p_include, d.parent_id))));
$$;

revoke all on function public.public_db_ok(uuid, boolean, uuid) from public, anon, authenticated;

-- Is p_db's table public through any live link of its workspace?
create or replace function public.database_is_public(p_db uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.pages d
      join public.page_public_links l on l.workspace_id = d.workspace_id and l.revoked_at is null
      join public.workspaces w on w.id = l.workspace_id and w.public_links
     where d.id = p_db
       and public.public_db_ok(l.page_id, l.include_children, p_db)
  );
$$;

revoke all on function public.database_is_public(uuid) from public, anon, authenticated;

-- Is this page on the open web: shown by a live link, or a live row a
-- public view lists (its files show in the table)?
create or replace function public.page_is_published(p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.pages p
      join public.page_public_links l on l.workspace_id = p.workspace_id and l.revoked_at is null
      join public.workspaces w on w.id = l.workspace_id and w.public_links
     where p.id = p_page
       and (public.public_path_ok(l.page_id, l.include_children, p_page)
            or (p.database_id is not null
                and p.deleted_at is null and p.archived_at is null and p.template_at is null
                and public.public_db_ok(l.page_id, l.include_children, p.database_id)))
  );
$$;

revoke all on function public.page_is_published(uuid) from public;
grant execute on function public.page_is_published(uuid) to anon, authenticated;

-- One database as a public view shows it: its live properties, its live
-- rows (the first 1000 in its own order), and its shared views when
-- p_views. p_mode is "here" (this link shows it) or "elsewhere" (public
-- through another link); p_rows_open says whether its rows open as pages.
create or replace function public.public_database_json(
  p_db uuid, p_mode text, p_rows_open boolean, p_views boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id,
    'title', d.title,
    'icon', d.icon,
    'mode', p_mode,
    'rows_open', p_rows_open,
    'page_layout', d.page_layout,
    'properties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pd.id, 'key', pd.key, 'label', pd.label, 'type', pd.type,
               'options', pd.options, 'config', pd.config, 'position', pd.position,
               'is_system', pd.is_system, 'description', pd.description,
               'database_id', pd.database_id)
             order by pd.position, pd.created_at)
        from public.property_defs pd
       where pd.database_id = d.id and pd.archived_at is null), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'icon', r.icon, 'props', r.props,
               'row_number', r.row_number, 'position', r.position,
               'created_at', r.created_at, 'created_by', r.created_by,
               'edited_at', r.edited_at, 'edited_by', r.edited_by,
               'verified_at', r.verified_at, 'verified_by', r.verified_by,
               'parent_id', r.parent_id, 'database_id', r.database_id,
               'is_database', r.is_database)
             order by r.ord)
        from (
          select x.*, row_number() over (order by x.position nulls last, x.edited_at desc) as ord
            from public.pages x
           where x.database_id = d.id
             and x.deleted_at is null and x.archived_at is null and x.template_at is null
           order by x.position nulls last, x.edited_at desc
           limit 1000
        ) r), '[]'::jsonb),
    'row_count', (
      select count(*)
        from public.pages x
       where x.database_id = d.id
         and x.deleted_at is null and x.archived_at is null and x.template_at is null),
    'views', case when p_views then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'icon', v.icon, 'layout', v.layout,
               'filter', v.filter, 'sort', v.sort, 'config', v.config,
               'group_by', v.group_by)
             order by v.position, v.name)
        from public.views v
       where v.database_id = d.id and v.scope::text = 'team'), '[]'::jsonb)
      else '[]'::jsonb end)
  from public.pages d
  where d.id = p_db;
$$;

revoke all on function public.public_database_json(uuid, text, boolean, boolean) from public, anon, authenticated;

-- What a visitor sees: the page at p_page (the published page itself when
-- null) if this link shows it, else null.
create or replace function public.get_published_page(p_token text, p_page uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.page_public_links;
  target uuid;
  pg public.pages;
  path jsonb;
  kids jsonb;
  mentioned jsonb;
  emoji jsonb;
  ws_name text;
  stale int;
  shown uuid[] := '{}';
  related uuid[] := '{}';
  dbs jsonb := '[]'::jsonb;
  missing jsonb := '[]'::jsonb;
  people jsonb;
  d uuid;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32}$' then
    return null;
  end if;
  select * into l from public.page_public_links where token = p_token and revoked_at is null;
  if l.page_id is null then
    return null;
  end if;
  select name, stale_days into ws_name, stale
    from public.workspaces where id = l.workspace_id and public_links;
  if ws_name is null then
    return null;
  end if;
  target := coalesce(p_page, l.page_id);
  if not public.public_path_ok(l.page_id, l.include_children, target) then
    return null;
  end if;
  select * into pg from public.pages where id = target;

  -- From the published page down to this one.
  with recursive up as (
    select p.id, p.parent_id, p.title, p.icon, 0 as depth from public.pages p where p.id = target
    union all
    select q.id, q.parent_id, q.title, q.icon, u.depth + 1
      from public.pages q join up u on q.id = u.parent_id
     where u.depth < 50 and u.id <> l.page_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'icon', icon) order by depth desc), '[]'::jsonb)
    into path from up;

  -- Its sub-pages this link shows (not a database's rows, which its views
  -- list, nor databases placed on the page, which show in place).
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'icon', c.icon, 'is_database', c.is_database)
                            order by c.position nulls last, c.created_at), '[]'::jsonb)
    into kids
    from public.pages c
   where l.include_children
     and c.parent_id = target
     and c.database_id is null
     and c.deleted_at is null and c.archived_at is null and c.template_at is null
     and c.access_type::text = 'workspace'
     and not (c.is_database and public.public_places(target, c.id));

  -- The pages it mentions that this link shows (others read "Private page").
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'icon', m.icon)), '[]'::jsonb)
    into mentioned
    from public.pages m
   where m.id in (
           select public.safe_uuid(x[1])
             from regexp_matches(coalesce(pg.blocks::text, ''), 'page:([0-9a-f-]{36})', 'g') as x)
     and public.public_path_ok(l.page_id, l.include_children, m.id);

  -- The workspace's custom emoji it uses.
  select coalesce(jsonb_agg(jsonb_build_object('name', e.name, 'path', e.path)), '[]'::jsonb)
    into emoji
    from public.custom_emoji e
   where e.workspace_id = l.workspace_id
     and (coalesce(pg.blocks::text, '') || ' ' || coalesce(pg.icon, '')) like '%:' || e.name || ':%';

  -- The databases it shows: the views placed in it, the database itself,
  -- and the database a row belongs to (its properties).
  for d in
    select distinct x.id from (
      select public.safe_uuid(v #>> '{}') as id
        from jsonb_path_query(coalesce(pg.blocks, '[]'::jsonb),
                              'lax $.** ? (@.type == "view").view.database_id') as v
      union select case when pg.is_database then pg.id end
      union select pg.database_id
    ) x
    where x.id is not null
  loop
    if public.public_db_ok(l.page_id, l.include_children, d) then
      shown := shown || d;
      dbs := dbs || jsonb_build_array(public.public_database_json(
        d, 'here',
        l.include_children and public.public_path_ok(l.page_id, l.include_children, d),
        d = pg.id));
    elsif public.database_is_public(d) then
      shown := shown || d;
      dbs := dbs || jsonb_build_array(public.public_database_json(d, 'elsewhere', false, false));
    elsif exists (select 1 from public.pages where id = d and workspace_id = l.workspace_id) then
      missing := missing || to_jsonb(d::text);
    end if;
  end loop;

  -- Databases their relations point at, when public, so relations read
  -- titles and rollups have values (one level; rows never open from here).
  select coalesce(array_agg(distinct t.id), '{}') into related
    from (
      select public.safe_uuid(coalesce(
               pd.config ->> 'database_id',
               (select near.database_id::text from public.property_defs near
                 where near.key = pd.config ->> 'of' and near.workspace_id = pd.workspace_id))) as id
        from public.property_defs pd
       where pd.database_id = any(shown) and pd.archived_at is null and pd.type::text = 'relation'
    ) t
   where t.id is not null and not (t.id = any(shown));
  foreach d in array related loop
    if public.database_is_public(d) then
      dbs := dbs || jsonb_build_array(public.public_database_json(d, 'related', false, false));
    end if;
  end loop;

  -- The people the shown values name, by name only.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id, 'name', pr.full_name, 'tint', pr.avatar_tint, 'ink', pr.avatar_ink)), '[]'::jsonb)
    into people
    from public.profiles pr
   where pr.id in (
           select public.safe_uuid(u)
             from jsonb_array_elements(dbs || jsonb_build_array(jsonb_build_object(
                    -- The opened page's own values (a row's property strip).
                    'properties', coalesce((select x -> 'properties' from jsonb_array_elements(dbs) x
                                             where x ->> 'id' = pg.database_id::text limit 1), '[]'::jsonb),
                    'rows', jsonb_build_array(jsonb_build_object(
                      'created_by', pg.created_by, 'edited_by', pg.edited_by,
                      'verified_by', pg.verified_by, 'props', pg.props))))) db,
                  jsonb_array_elements(db -> 'rows') r,
                  lateral (
                    select r ->> 'created_by' as u
                    union all select r ->> 'edited_by'
                    union all select r ->> 'verified_by'
                    union all
                    select case jsonb_typeof(r -> 'props' -> (p ->> 'key'))
                             when 'string' then r -> 'props' ->> (p ->> 'key') end
                      from jsonb_array_elements(db -> 'properties') p
                     where p ->> 'type' = 'person'
                    union all
                    select e #>> '{}'
                      from jsonb_array_elements(db -> 'properties') p,
                           jsonb_array_elements(case jsonb_typeof(r -> 'props' -> (p ->> 'key'))
                                                  when 'array' then r -> 'props' -> (p ->> 'key')
                                                  else '[]'::jsonb end) e
                     where p ->> 'type' = 'person'
                  ) ids
            where u is not null);

  return jsonb_build_object(
    'workspace', ws_name,
    'root', l.page_id,
    'page', jsonb_build_object(
      'id', pg.id,
      'title', pg.title,
      'icon', pg.icon,
      'blocks', coalesce(pg.blocks, '[]'::jsonb),
      'is_database', pg.is_database,
      'database_id', pg.database_id,
      'props', coalesce(pg.props, '{}'::jsonb),
      'row_number', pg.row_number,
      'created_at', pg.created_at,
      'created_by', pg.created_by,
      'edited_at', pg.edited_at,
      'edited_by', pg.edited_by,
      'verified_at', pg.verified_at,
      'verified_by', pg.verified_by),
    'path', path,
    'children', kids,
    'mentioned', mentioned,
    'emoji', emoji,
    'databases', dbs,
    'unavailable', missing,
    'people', people,
    'stale_days', coalesce(stale, 30));
end $$;

revoke all on function public.get_published_page(text, uuid) from public;
grant execute on function public.get_published_page(text, uuid) to anon, authenticated;
