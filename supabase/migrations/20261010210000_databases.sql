-- Databases (Allan, 2026-10-10): Notion's structure.
--
-- A database is a page (is_database) whose direct children are its rows.
-- It owns its properties (property_defs.database_id) and its views
-- (views.database_id). pages.database_id is kept by trigger: the parent's
-- id when the parent is a database, else null. A plain page has no
-- properties beyond the built-ins. The page tree has no depth cap any
-- more (the cycle guard stays). Children inherit access from their parent
-- when they're made; a page and its subtree go to the bin together and
-- come back together.
--
-- Property keys stay unique per workspace (the constraint is kept), so a
-- second "Status" in another database gets the key status_2: labels are
-- what people see, keys are internal.
--
-- Existing content: one database "Pages" per workspace takes every page
-- that was at the top level, with the workspace's properties and views.
-- Pages placed inside others stay where they are, as plain pages.

-- ─────────────────────────── Columns ───────────────────────────

alter table public.pages
  add column if not exists is_database boolean not null default false;
alter table public.pages
  add column if not exists database_id uuid references public.pages(id);
create index if not exists pages_database_id_idx on public.pages (database_id) where deleted_at is null;
create index if not exists pages_parent_id_idx on public.pages (parent_id) where deleted_at is null;

alter table public.property_defs
  add column if not exists database_id uuid references public.pages(id);
create index if not exists property_defs_database_id_idx on public.property_defs (database_id);

alter table public.views
  add column if not exists database_id uuid references public.pages(id);
create index if not exists views_database_id_idx on public.views (database_id);

-- ─────────────────────────── Tree guard: no depth cap ───────────────────────────

create or replace function public.guard_page_parent()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  hops int;
  same_ws boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A page cannot be placed inside itself'
      using errcode = 'check_violation';
  end if;

  select p.workspace_id = new.workspace_id into same_ws
  from pages p where p.id = new.parent_id;

  if same_ws is distinct from true then
    raise exception 'A page can only be placed inside a page in the same workspace'
      using errcode = 'check_violation';
  end if;

  -- Walk UPWARD from the proposed parent. If we meet this page, the edge
  -- would close a loop. Bounded, so it ends even on data that is already
  -- cyclic.
  with recursive up as (
    select new.parent_id as id, 1 as hops
    union all
    select p.parent_id, up.hops + 1
    from pages p join up on p.id = up.id
    where p.parent_id is not null and up.hops < 200
  )
  select count(*) into hops from up where id = new.id;

  if hops > 0 then
    raise exception 'That page already sits inside this one'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- ─────────────────────────── database_id by trigger ───────────────────────────

create or replace function public.set_page_database()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.parent_id is null then
    new.database_id := null;
  else
    select case when p.is_database then p.id else null end
      into new.database_id
      from public.pages p where p.id = new.parent_id;
  end if;
  -- A database stays a database: its rows and views depend on it.
  if tg_op = 'UPDATE' and old.is_database and not new.is_database then
    raise exception 'A database can''t be turned back into a page.'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

-- Named to run before the other BEFORE triggers on pages (alphabetical).
create or replace trigger pages_0_database
  before insert or update of parent_id, is_database on public.pages
  for each row execute function public.set_page_database();

-- When a page becomes a database, its children become its rows.
create or replace function public.adopt_rows_on_database()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.is_database and not old.is_database then
    update public.pages set database_id = new.id where parent_id = new.id;
  end if;
  return null;
end $function$;

create or replace trigger pages_adopt_rows
  after update of is_database on public.pages
  for each row execute function public.adopt_rows_on_database();

-- ─────────────────────────── Children inherit access ───────────────────────────

-- Before insert: a page made inside another takes its parent's access.
create or replace function public.inherit_parent_access()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare par public.pages;
begin
  if new.parent_id is not null then
    select * into par from public.pages where id = new.parent_id;
    if par.id is not null then
      new.access_type := par.access_type;
      new.ws_role := par.ws_role;
    end if;
  end if;
  return new;
end $function$;

create or replace trigger pages_1_inherit_access
  before insert on public.pages
  for each row execute function public.inherit_parent_access();

-- After insert: the parent's people get the same access on the child; the
-- creator can always edit what they made.
create or replace function public.grant_creator_page_access()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.parent_id is not null then
    insert into page_access (page_id, user_id, guest_email, capability)
    select new.id, a.user_id, a.guest_email, a.capability
      from page_access a where a.page_id = new.parent_id
    on conflict do nothing;
  end if;
  if new.access_type = 'restricted' and new.created_by is not null then
    insert into page_access (page_id, user_id, capability)
    values (new.id, new.created_by, 'write')
    on conflict (page_id, user_id) where user_id is not null
    do update set capability = 'write';
  end if;
  return null;
end $function$;

-- ─────────────────────────── Bin: a page and its subtree together ───────────────────────────

create or replace function public.can_edit_page(p_page uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select public.can_edit_page_row(p) from public.pages p where p.id = p_page), false);
$function$;

create or replace function public.delete_page(p_page uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  did boolean := false;
  stamp timestamptz := now();
begin
  update public.pages p
     set deleted_at = stamp
   where p.id = p_page
     and p.deleted_at is null
     and public.can_edit_page_row(p);
  get diagnostics did = ROW_COUNT;

  -- Everything placed inside goes with it, at the same moment, so a
  -- restore knows what came along. Pages the person can't edit stay.
  if did then
    with recursive sub as (
      select c.id from public.pages c where c.parent_id = p_page
      union all
      select c.id from public.pages c join sub on c.parent_id = sub.id
    )
    update public.pages p
       set deleted_at = stamp
      from sub
     where p.id = sub.id
       and p.deleted_at is null
       and public.can_edit_page_row(p);
  end if;
end;
$function$;

create or replace function public.restore_page(p_page uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare stamp timestamptz;
begin
  select deleted_at into stamp from public.pages where id = p_page;
  if stamp is null then return; end if;
  update public.pages p set deleted_at = null
   where p.id = p_page and public.is_member(p.workspace_id);
  -- What went to the bin with it comes back with it.
  with recursive sub as (
    select c.id from public.pages c where c.parent_id = p_page
    union all
    select c.id from public.pages c join sub on c.parent_id = sub.id
  )
  update public.pages p set deleted_at = null
    from sub
   where p.id = sub.id and p.deleted_at = stamp;
end;
$function$;

-- ─────────────────────────── Properties belong to a database ───────────────────────────

create or replace function public.validate_page_props()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare k text; d public.property_defs; v jsonb; s text;
begin
  for k in select jsonb_object_keys(new.props) loop
    -- An update checks only the properties it changes, so one stale value
    -- never locks the rest of the page.
    if tg_op = 'UPDATE' and (old.props -> k) is not distinct from (new.props -> k) then
      continue;
    end if;
    v := new.props -> k;
    if v = 'null'::jsonb then continue; end if;
    if new.database_id is null then
      raise exception 'This page isn''t in a database, so it has no properties.'
        using errcode = '23514';
    end if;
    select * into d from public.property_defs
     where database_id = new.database_id and key = k;
    if d.id is null then
      raise exception 'Unknown property "%" for this database.', k
        using errcode='23514';
    end if;
    case d.type::text
      when 'multi_select' then
        if jsonb_typeof(v) <> 'array' then raise exception '% must be an array', k; end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then raise exception '% must be a boolean', k; end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' then raise exception '% must be a number', k; end if;
      when 'date' then
        if jsonb_typeof(v) <> 'string' then
          raise exception '% must be a date', k using errcode = '23514';
        end if;
        s := v #>> '{}';
        if s ~ '^\d{4}-\d{2}-\d{2}/\d{4}-\d{2}-\d{2}$' then
          if to_date(split_part(s, '/', 2), 'YYYY-MM-DD') < to_date(split_part(s, '/', 1), 'YYYY-MM-DD') then
            raise exception '% ends before it starts', k using errcode = '23514';
          end if;
          perform to_date(split_part(s, '/', 1), 'YYYY-MM-DD');
        elsif s ~ '^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$' then
          perform to_date(left(s, 10), 'YYYY-MM-DD');
        else
          raise exception '% must be a date or a date range', k using errcode = '23514';
        end if;
      when 'relation' then
        if jsonb_typeof(d.config -> 'of') = 'string' then
          raise exception '% is worked out from %, so it can''t be set directly', k, d.config ->> 'of'
            using errcode = '23514';
        end if;
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 500 then
          raise exception '% must be a list of pages', k using errcode = '23514';
        end if;
        if exists (
          select 1 from jsonb_array_elements(v) e
           where jsonb_typeof(e) <> 'string'
              or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        ) then
          raise exception '% must be a list of pages', k using errcode = '23514';
        end if;
      when 'rollup' then
        raise exception '% is worked out from related pages, so it can''t be set directly', k
          using errcode = '23514';
      when 'select' then
        if d.open_values then
          if jsonb_typeof(v) <> 'string' then
            raise exception '% must be a string', k;
          end if;
        elsif jsonb_array_length(d.options) > 0
           and not (d.options @> jsonb_build_array(jsonb_build_object('value', v #>> '{}')))
        then raise exception '% is not a legal value for %', v #>> '{}', k; end if;
      when 'status' then
        if jsonb_array_length(d.options) > 0
           and not (d.options @> jsonb_build_array(jsonb_build_object('value', v #>> '{}')))
        then raise exception '% is not a legal value for %', v #>> '{}', k; end if;
      when 'url' then
        if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 2048 then
          raise exception '% must be a link', k;
        end if;
      when 'email' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
          raise exception '% must be an email address', k;
        end if;
      when 'phone' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\+?[0-9 ().-]{4,32}$' then
          raise exception '% must be a phone number', k;
        end if;
      else null;
    end case;
  end loop;
  return new;
end $function$;

-- A relation points at a database (its rows are what it can link to).
create or replace function public.guard_property_config()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare c jsonb := new.config;
begin
  if new.type::text = 'relation' then
    if exists (select 1 from jsonb_object_keys(c) k where k not in ('database_id', 'back', 'of')) then
      raise exception 'A relation''s settings are database_id, back and of.' using errcode = '23514';
    end if;
    if c ? 'database_id' and not exists (
      select 1 from public.pages p
       where p.id::text = c ->> 'database_id' and p.is_database and p.workspace_id = new.workspace_id
    ) then
      raise exception 'A relation links to a database in this workspace.' using errcode = '23514';
    end if;
    if (c ? 'of' and (jsonb_typeof(c -> 'of') is distinct from 'string'
                      or (c ->> 'of') !~ '^[a-z][a-z0-9_]{0,30}$'))
       or (c ? 'back' and jsonb_typeof(c -> 'back') <> 'null' and (c ->> 'back') !~ '^[a-z][a-z0-9_]{0,30}$') then
      raise exception 'A relation''s partner must be a property key.' using errcode = '23514';
    end if;
  elsif new.type::text = 'rollup' then
    if exists (select 1 from jsonb_object_keys(c) k where k not in ('relation', 'target', 'calc'))
       or jsonb_typeof(c -> 'relation') is distinct from 'string'
       or jsonb_typeof(c -> 'target') is distinct from 'string'
       or jsonb_typeof(c -> 'calc') is distinct from 'string' then
      raise exception 'A rollup needs a relation, a property and a calculation.' using errcode = '23514';
    end if;
  elsif c <> '{}'::jsonb then
    raise exception 'Only relations and rollups have settings.' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and ((old.config ? 'of') is distinct from (new.config ? 'of')
                            or (old.config ->> 'of') is distinct from (new.config ->> 'of')) then
    raise exception 'The far side of a relation stays paired with its relation.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.database_id is not null
     and new.database_id is distinct from old.database_id then
    raise exception 'A property stays in its database.' using errcode = '23514';
  end if;
  return new;
end $function$;

create or replace trigger property_defs_guard_config
  before insert or update of config, type, database_id on public.property_defs
  for each row execute function public.guard_property_config();

-- Only people who can edit a database change its properties; its
-- properties are visible to whoever can open it.
alter policy propdefs_read on public.property_defs
  using (is_member(workspace_id) and (database_id is null or public.can_read_page(database_id)));
alter policy propdefs_insert_rules on public.property_defs
  with check (
    is_system = false and archived_at is null and created_by = (select auth.uid())
    and database_id is not null
    and (public.can_edit_page(database_id) or is_owner(workspace_id))
  );
alter policy propdefs_write on public.property_defs
  using (is_member(workspace_id) and (is_owner(workspace_id) or (database_id is not null and public.can_edit_page(database_id))))
  with check (is_member(workspace_id) and (is_owner(workspace_id) or (database_id is not null and public.can_edit_page(database_id))));

-- ─────────────────────────── Views belong to a database ───────────────────────────

-- Shared views: everyone who can open the database. Anyone who can edit
-- the database page adds or changes shared views; workspace owners too.
alter policy views_read on public.views
  using (
    is_member(workspace_id)
    and (owner_id = (select auth.uid())
         or (scope = 'team'::view_scope and (database_id is null or public.can_read_page(database_id))))
  );

alter policy views_insert on public.views
  with check (
    is_member(workspace_id)
    and owner_id = (select auth.uid())
    and (scope = 'personal'::view_scope
         or (database_id is not null and (public.can_edit_page(database_id) or is_owner(workspace_id))))
  );

alter policy views_update on public.views
  using (
    owner_id = (select auth.uid())
    or (scope = 'team'::view_scope
        and (is_owner(workspace_id) or (database_id is not null and public.can_edit_page(database_id))))
  )
  with check (
    owner_id = (select auth.uid())
    or (scope = 'team'::view_scope
        and (is_owner(workspace_id) or (database_id is not null and public.can_edit_page(database_id))))
  );

create or replace function public.publish_view(p_view uuid)
returns views
language plpgsql
set search_path to 'public'
as $function$
declare r public.views;
begin
  update public.views v set scope = 'team'
   where v.id = p_view
     and v.owner_id = auth.uid()
     and (public.is_owner(v.workspace_id)
          or (v.database_id is not null and public.can_edit_page(v.database_id)))
  returning * into r;
  if r.id is null then
    raise exception 'You need edit access to this database to share a view.'
      using errcode = '42501';
  end if;
  return r;
end $function$;

-- A copy keeps the database, grouping and table settings.
create or replace function public.fork_view(p_view uuid, p_name text, p_filter jsonb, p_sort jsonb, p_layout view_layout)
returns views
language sql
set search_path to 'public'
as $function$
  insert into public.views (workspace_id, owner_id, name, scope, layout, filter, sort, database_id, group_by, config)
  select workspace_id, auth.uid(), p_name, 'personal', p_layout, p_filter, p_sort, database_id, group_by, config
    from public.views where id = p_view returning *;
$function$;

-- ─────────────────────────── Existing content: the "Pages" database ───────────────────────────

do $migrate$
declare w record; db uuid; who uuid;
begin
  for w in select id from public.workspaces loop
    if not exists (select 1 from public.pages p where p.workspace_id = w.id) then
      continue;
    end if;
    select user_id into who from public.workspace_members
     where workspace_id = w.id and role = 'owner' order by created_at limit 1;
    if who is null then
      select user_id into who from public.workspace_members where workspace_id = w.id limit 1;
    end if;
    insert into public.pages (workspace_id, title, icon, props, blocks, created_by, edited_by, verified_by,
                              access_type, ws_role, is_database)
    values (w.id, 'Pages', '🗂️', '{}', '[]', who, who, who, 'workspace', 'edit', true)
    returning id into db;
    -- Every top-level page becomes a row; placed pages stay placed.
    update public.pages set parent_id = db
     where workspace_id = w.id and id <> db and parent_id is null;
    -- The workspace's properties and views now belong to it. The old
    -- built-ins become ordinary properties, so they can be changed (the
    -- guard that keeps is_system fixed is stepped around for this one
    -- move; it's back on right after).
    alter table public.property_defs disable trigger property_defs_guard;
    update public.property_defs set database_id = db, is_system = false where workspace_id = w.id;
    alter table public.property_defs enable trigger property_defs_guard;
    update public.views set database_id = db where workspace_id = w.id;
    update public.property_defs
       set config = (config - 'view_id') || jsonb_build_object('database_id', db::text)
     where workspace_id = w.id and type::text = 'relation' and not (config ? 'of');
  end loop;
end $migrate$;

-- Views inside pages made before today point at "Pages".
update public.pages p
   set blocks = (
     select jsonb_agg(
       case when b ->> 'type' = 'view' and b ? 'view' and not ((b -> 'view') ? 'database_id')
            then jsonb_set(b, '{view,database_id}', to_jsonb(p.database_id::text))
            else b end)
       from jsonb_array_elements(p.blocks) b)
 where p.database_id is not null
   and jsonb_typeof(p.blocks) = 'array'
   and exists (select 1 from jsonb_array_elements(p.blocks) b where b ->> 'type' = 'view');

alter table public.property_defs alter column database_id set not null;
alter table public.views alter column database_id set not null;
