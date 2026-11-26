-- Page covers (Allan, 2026-11-25): Notion's cover image across the top of
-- a page. Allan took the recommended answers: gallery, upload and link (no
-- Unsplash yet); page history leaves covers alone; exports stay without
-- them; phones show them and change them from the Actions sheet.
--
-- 1. pages.cover: null, or { kind, value, position }:
--      gallery  value names one of Gio's colours or gradients
--      upload   value is a storage path in the page's own folder of the
--               page-images bucket (<workspace>/<page>/...), so exactly the
--               people who can open the page can see it
--      link     value is an http(s) address
--    position (0-100, optional) is how far down the image is shown.
--    page_cover_ok checks the shape; the browser can't store anything else.
-- 2. A cover change is an edit: people who can't edit the page can't make
--    one (guard_page_edit), and it moves the page's Edited stamp
--    (pages_touch_cover). Page history doesn't keep covers.
-- 3. Public pages show the cover (get_published_page's page.cover); an
--    uploaded one is signed for visitors like the page's other images.

alter table public.pages add column if not exists cover jsonb;

create or replace function public.page_cover_ok(p_cover jsonb, p_workspace uuid, p_page uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_cover is null
      or (jsonb_typeof(p_cover) = 'object'
          and (select count(*) from jsonb_object_keys(p_cover) k where k not in ('kind', 'value', 'position')) = 0
          and jsonb_typeof(p_cover -> 'value') = 'string'
          and length(p_cover ->> 'value') between 1 and 2000
          and (p_cover -> 'position' is null
               or (jsonb_typeof(p_cover -> 'position') = 'number'
                   and (p_cover ->> 'position')::numeric between 0 and 100))
          and case p_cover ->> 'kind'
                when 'gallery' then (p_cover ->> 'value') ~ '^[a-z][a-z0-9-]{0,30}$'
                when 'upload' then starts_with(p_cover ->> 'value', p_workspace::text || '/' || p_page::text || '/')
                                   and (p_cover ->> 'value') !~ '\.\.'
                when 'link' then (p_cover ->> 'value') ~* '^https?://[^\s]+$'
                else false
              end);
$$;

alter table public.pages
  add constraint pages_cover_shape check (public.page_cover_ok(cover, workspace_id, id));

-- Changing the cover needs edit rights, like the title or the icon.
create or replace function public.guard_page_edit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- System work (no signed-in person) isn't a person editing.
  if auth.uid() is null then
    return new;
  end if;
  -- Only content and state changes need edit rights.
  if (old.title, old.blocks, old.props, old.icon, old.cover,
      old.deleted_at, old.archived_at, old.template_at)
     is not distinct from
     (new.title, new.blocks, new.props, new.icon, new.cover,
      new.deleted_at, new.archived_at, new.template_at)
     and (new.parent_id is not distinct from old.parent_id or new.parent_id is null) then
    return new;
  end if;
  if not public.can_edit_page_row(old) then
    raise exception 'You can view this page but not edit it.' using errcode = '42501';
  end if;
  return new;
end $function$;

-- A new cover moves the Edited stamp (pages_touch covers the title,
-- blocks, values and icon).
create trigger pages_touch_cover
  before update of cover on public.pages
  for each row
  when (old.cover is distinct from new.cover)
  execute function public.touch_page();

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
      'verified_by', pg.verified_by,
      'cover', pg.cover),
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
