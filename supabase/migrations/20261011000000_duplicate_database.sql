-- Duplicating a database (Allan, 2026-10-10, Step 4): a copy is a whole
-- database, not an empty page. duplicate_database copies the database page,
-- its live properties (under new keys: keys are unique per workspace), the
-- views the caller can see, and the rows the caller can read, with their
-- values moved to the new keys.
--
-- Relations: one inside the database (rows linking to rows of the same
-- database) is rebuilt between the copies. One to another database is
-- copied one way: its far side lives in the other database and stays paired
-- with the original. A far side whose relation lives elsewhere isn't
-- copied (it would show the same links twice). Rollups follow their
-- relation. Pages inside rows, and inline views elsewhere, aren't copied.
--
-- The copy sits beside the original and is private to its maker, like any
-- new page (the access triggers do that). Returns the new database's id.

create or replace function public.dup_view_json(j jsonb, m jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $function$
  -- Rewrite property keys in a view's filter, sort or config by the map
  -- m (old key -> new key): "prop" and "group" values, the "props" list,
  -- and the keys of "widths" and "calcs". Built-ins (@…) and anything not
  -- in the map pass through unchanged.
  select case
    when j is null then null
    when jsonb_typeof(j) = 'array' then coalesce((
      select jsonb_agg(public.dup_view_json(e, m) order by o)
        from jsonb_array_elements(j) with ordinality as x(e, o)), '[]'::jsonb)
    when jsonb_typeof(j) = 'object' then coalesce((
      select jsonb_object_agg(k,
               case
                 when k in ('prop', 'group') and jsonb_typeof(v) = 'string' and m ? (v #>> '{}')
                   then to_jsonb(m ->> (v #>> '{}'))
                 when k = 'props' and jsonb_typeof(v) = 'array'
                   then coalesce((select jsonb_agg(
                                    case when jsonb_typeof(e) = 'string' and m ? (e #>> '{}')
                                         then to_jsonb(m ->> (e #>> '{}')) else e end order by o)
                                    from jsonb_array_elements(v) with ordinality as y(e, o)), '[]'::jsonb)
                 when k in ('widths', 'calcs') and jsonb_typeof(v) = 'object'
                   then coalesce((select jsonb_object_agg(coalesce(m ->> kk, kk), vv)
                                    from jsonb_each(v) as z(kk, vv)), '{}'::jsonb)
                 else public.dup_view_json(v, m)
               end)
        from jsonb_each(j) as w(k, v)), '{}'::jsonb)
    else j
  end;
$function$;

create or replace function public.duplicate_database(p_database uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  src public.pages;
  par public.pages;
  me uuid := auth.uid();
  new_db uuid := gen_random_uuid();
  km jsonb := '{}'::jsonb;     -- old key -> new key
  rm jsonb := '{}'::jsonb;     -- old row id -> new row id
  self_rel text[] := '{}';     -- relation keys (old) that link inside this database
  d public.property_defs;
  near public.property_defs;
  nk text;
  n int;
  cfg jsonb;
  r public.pages;
  new_row uuid;
  next_props jsonb;
  k text;
  v jsonb;
  vw public.views;
begin
  select * into src from public.pages where id = p_database and deleted_at is null;
  if src.id is null or not src.is_database or not public.is_member(src.workspace_id)
     or not public.can_read_page(src.id) then
    raise exception 'That database is no longer there.' using errcode = 'P0002';
  end if;
  if src.parent_id is not null then
    select * into par from public.pages where id = src.parent_id and deleted_at is null;
    if par.id is not null and not public.can_edit_page_row(par) then
      raise exception 'You can''t add pages inside "%".', coalesce(nullif(par.title, ''), 'Untitled')
        using errcode = '42501';
    end if;
  end if;

  insert into public.pages (id, workspace_id, title, icon, blocks, props, is_database, parent_id,
                            access_type, created_by, edited_by, verified_by)
  values (new_db, src.workspace_id, coalesce(nullif(src.title, ''), 'Untitled') || ' (copy)', src.icon,
          src.blocks, '{}'::jsonb, true, src.parent_id, 'restricted', me, me, me);

  -- New keys for the live properties: the old key with the first free
  -- number (keys are unique across the workspace, archived ones included).
  for d in select * from public.property_defs
            where database_id = src.id and archived_at is null order by position, created_at loop
    n := 2;
    loop
      nk := left(d.key, 27) || '_' || n;
      exit when not exists (select 1 from public.property_defs x
                             where x.workspace_id = src.workspace_id and x.key = nk)
            and not exists (select 1 from jsonb_each_text(km) e where e.value = nk);
      n := n + 1;
    end loop;
    km := km || jsonb_build_object(d.key, nk);
  end loop;

  for d in select * from public.property_defs
            where database_id = src.id and archived_at is null order by position, created_at loop
    cfg := d.config;
    if d.type::text = 'relation' then
      if cfg ? 'of' then
        -- A far side: copied only when its relation is in this database.
        if not (km ? (cfg ->> 'of')) then continue; end if;
        cfg := jsonb_build_object('of', km ->> (cfg ->> 'of'));
      elsif (cfg ->> 'database_id') = src.id::text then
        self_rel := self_rel || d.key;
        cfg := jsonb_build_object('database_id', new_db::text)
               || case when cfg ? 'back' and jsonb_typeof(cfg -> 'back') = 'string' and km ? (cfg ->> 'back')
                       then jsonb_build_object('back', km ->> (cfg ->> 'back')) else '{}'::jsonb end;
      else
        -- To another database: one way (its far side stays with the original).
        cfg := jsonb_build_object('database_id', cfg -> 'database_id');
      end if;
    elsif d.type::text = 'rollup' then
      if not (km ? (cfg ->> 'relation')) then continue; end if;
      select * into near from public.property_defs
       where database_id = src.id and key = cfg ->> 'relation';
      cfg := jsonb_build_object(
        'relation', km ->> (cfg ->> 'relation'),
        'target', case when (near.config ->> 'database_id') = src.id::text and km ? (cfg ->> 'target')
                       then km ->> (cfg ->> 'target') else cfg ->> 'target' end,
        'calc', cfg -> 'calc');
    end if;
    insert into public.property_defs (workspace_id, database_id, key, label, type, options, position,
                                      is_system, open_values, config, created_by)
    values (src.workspace_id, new_db, km ->> d.key, d.label, d.type, d.options, d.position,
            false, d.open_values, cfg, me);
  end loop;

  -- Rows the caller can read, in their order; values under the new keys.
  -- Links inside the database are set once every row exists.
  for r in select * from public.pages p
            where p.parent_id = src.id and p.deleted_at is null and p.archived_at is null
              and public.can_read_page(p.id)
            order by p.position nulls last, p.created_at, p.id loop
    new_row := gen_random_uuid();
    rm := rm || jsonb_build_object(r.id::text, new_row::text);
    next_props := '{}'::jsonb;
    for k, v in select key, value from jsonb_each(r.props) loop
      if not (km ? k) or k = any(self_rel) then continue; end if;
      if not exists (select 1 from public.property_defs x
                      where x.database_id = new_db and x.key = km ->> k) then continue; end if;
      next_props := next_props || jsonb_build_object(km ->> k, v);
    end loop;
    insert into public.pages (id, workspace_id, title, icon, blocks, props, parent_id, position,
                              template_at, access_type, created_by, edited_by, verified_by)
    values (new_row, src.workspace_id, r.title, r.icon, r.blocks, next_props, new_db, r.position,
            r.template_at, 'restricted', me, me, me);
  end loop;

  if array_length(self_rel, 1) > 0 then
    for r in select * from public.pages p
              where p.parent_id = src.id and rm ? p.id::text loop
      next_props := '{}'::jsonb;
      foreach k in array self_rel loop
        v := r.props -> k;
        if v is null or jsonb_typeof(v) <> 'array' then continue; end if;
        next_props := next_props || jsonb_build_object(km ->> k, (
          select coalesce(jsonb_agg(to_jsonb(rm ->> (e #>> '{}'))), '[]'::jsonb)
            from jsonb_array_elements(v) e where rm ? (e #>> '{}')));
      end loop;
      if next_props <> '{}'::jsonb then
        update public.pages set props = props || next_props
         where id = (rm ->> r.id::text)::uuid;
      end if;
    end loop;
  end if;

  -- Views: the shared ones and the caller's own, keys rewritten.
  for vw in select * from public.views
             where database_id = src.id and (scope = 'team' or owner_id = me)
             order by position, created_at loop
    insert into public.views (workspace_id, owner_id, name, scope, layout, group_by, filter, sort,
                              position, icon, config, database_id)
    values (src.workspace_id, me, vw.name, vw.scope, vw.layout,
            case when vw.group_by is not null and km ? vw.group_by then km ->> vw.group_by else vw.group_by end,
            public.dup_view_json(vw.filter, km), public.dup_view_json(vw.sort, km),
            vw.position, vw.icon, public.dup_view_json(vw.config, km), new_db);
  end loop;

  return new_db;
end $function$;

revoke all on function public.duplicate_database(uuid) from public, anon;
grant execute on function public.duplicate_database(uuid) to authenticated;
revoke all on function public.dup_view_json(jsonb, jsonb) from public, anon;
