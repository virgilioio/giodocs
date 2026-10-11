-- Property settings (Allan, 2026-10-11; Notion's column menu):
--   1. A description on every property (shown as the heading's tooltip).
--   2. Property access: a property can be set so only workspace owners
--      change its values (config.access = 'owners'). Only owners set it.
--   3. Person properties: Limit (config.limit = 1: one person; unset: any
--      number, stored as a list), Default (config.default = 'me' or a
--      member's id, given to new rows) and Notifications (config.notify,
--      on unless false: people added to it hear about it in their inbox).
--      A person value is a member id, or a list of them.
--   4. Change type with values: change_property_type converts every value
--      it can read in the new type and keeps the old ones, so
--      undo_property_type_change puts everything back (within an hour, by
--      the person who changed it).
-- Values are still checked by validate_page_props; nothing here gets
-- around it. Nothing here removes any row.

-- 1. Description ----------------------------------------------------------

alter table public.property_defs
  add column if not exists description text not null default '';

alter table public.property_defs
  add constraint property_defs_description_len check (char_length(description) <= 280);

-- 2 & 3. Settings every type may carry, and the person's own ---------------

create or replace function public.guard_property_config()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  c jsonb := coalesce(new.config, '{}'::jsonb);
  base jsonb;
begin
  -- Property access, on any type.
  if c ? 'access' and (jsonb_typeof(c -> 'access') <> 'string' or (c ->> 'access') <> 'owners') then
    raise exception 'A property''s access is "owners" or unset.' using errcode = '23514';
  end if;
  base := c - 'access';

  if new.type::text = 'relation' then
    if exists (select 1 from jsonb_object_keys(base) k where k not in ('database_id', 'back', 'of')) then
      raise exception 'A relation''s settings are database_id, back and of.' using errcode = '23514';
    end if;
    if base ? 'database_id' and not exists (
      select 1 from public.pages p
       where p.id::text = base ->> 'database_id' and p.is_database and p.workspace_id = new.workspace_id
    ) then
      raise exception 'A relation links to a database in this workspace.' using errcode = '23514';
    end if;
    if (base ? 'of' and (jsonb_typeof(base -> 'of') is distinct from 'string'
                         or (base ->> 'of') !~ '^[a-z][a-z0-9_]{0,30}$'))
       or (base ? 'back' and jsonb_typeof(base -> 'back') <> 'null' and (base ->> 'back') !~ '^[a-z][a-z0-9_]{0,30}$') then
      raise exception 'A relation''s partner must be a property key.' using errcode = '23514';
    end if;
  elsif new.type::text = 'rollup' then
    if exists (select 1 from jsonb_object_keys(base) k where k not in ('relation', 'target', 'calc'))
       or jsonb_typeof(base -> 'relation') is distinct from 'string'
       or jsonb_typeof(base -> 'target') is distinct from 'string'
       or jsonb_typeof(base -> 'calc') is distinct from 'string' then
      raise exception 'A rollup needs a relation, a property and a calculation.' using errcode = '23514';
    end if;
  elsif new.type::text = 'number' then
    if exists (select 1 from jsonb_object_keys(base) k where k not in ('format', 'decimals', 'currency'))
       or (base ? 'format' and (base ->> 'format') not in ('number', 'comma', 'percent', 'currency'))
       or (base ? 'decimals' and (jsonb_typeof(base -> 'decimals') <> 'number'
                                  or (base ->> 'decimals')::numeric not in (0, 1, 2, 3, 4, 5, 6)))
       or (base ? 'currency' and (base ->> 'currency') not in ('USD', 'MXN', 'EUR', 'GBP', 'CAD', 'BRL', 'COP')) then
      raise exception 'A number shows as number, comma, percent or currency, with 0 to 6 decimals.'
        using errcode = '23514';
    end if;
  elsif new.type::text = 'unique_id' then
    if exists (select 1 from jsonb_object_keys(base) k where k <> 'prefix')
       or (base ? 'prefix' and (jsonb_typeof(base -> 'prefix') <> 'string' or (base ->> 'prefix') !~ '^[A-Za-z0-9]{0,10}$')) then
      raise exception 'An ID''s prefix is up to 10 letters and digits.' using errcode = '23514';
    end if;
  elsif new.type::text = 'formula' then
    if exists (select 1 from jsonb_object_keys(base) k where k <> 'expression')
       or (base ? 'expression' and (jsonb_typeof(base -> 'expression') <> 'string' or length(base ->> 'expression') > 2000)) then
      raise exception 'A formula is one expression of up to 2000 characters.' using errcode = '23514';
    end if;
  elsif new.type::text = 'person' then
    if exists (select 1 from jsonb_object_keys(base) k where k not in ('limit', 'default', 'notify'))
       or (base ? 'limit' and (jsonb_typeof(base -> 'limit') <> 'number' or (base ->> 'limit')::numeric <> 1))
       or (base ? 'notify' and jsonb_typeof(base -> 'notify') <> 'boolean')
       or (base ? 'default' and (jsonb_typeof(base -> 'default') <> 'string'
           or ((base ->> 'default') <> 'me'
               and not exists (select 1 from public.workspace_members m
                                where m.workspace_id = new.workspace_id
                                  and m.user_id::text = base ->> 'default')))) then
      raise exception 'A person property''s settings are a limit of one person, a default (you or a member) and whether to notify.'
        using errcode = '23514';
    end if;
  elsif base <> '{}'::jsonb then
    raise exception 'Only relations, rollups, numbers, IDs, formulas and people have settings.' using errcode = '23514';
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

-- A change of type keeps who may change the values; the rest of the
-- settings belong to the old type.
create or replace function public.reset_config_on_retype()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.type is distinct from old.type and new.config is not distinct from old.config then
    new.config := case when old.config ? 'access'
                       then jsonb_build_object('access', old.config -> 'access')
                       else '{}'::jsonb end;
  end if;
  return new;
end $function$;

-- Only owners decide who may change a property's values.
create or replace function public.guard_property_access()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (old.config ->> 'access') is distinct from (new.config ->> 'access')
     and auth.uid() is not null
     and not public.is_owner(old.workspace_id) then
    raise exception 'Only workspace owners can change who edits a property.' using errcode = '42501';
  end if;
  return new;
end $function$;

create trigger property_defs_guard_access
  before update of config on public.property_defs
  for each row execute function public.guard_property_access();

-- People in a person value, whatever its shape.
create or replace function public.person_ids(v jsonb)
returns uuid[]
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(array_agg(x::uuid), '{}'::uuid[])
    from (
      select e #>> '{}' as x
        from jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) e
       where jsonb_typeof(e) = 'string'
      union all
      select v #>> '{}' where jsonb_typeof(v) = 'string'
    ) s
   where x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$function$;

-- What a new row starts with for a property, or null.
create or replace function public.property_default_value(d public.property_defs)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare who text;
begin
  if d.type::text <> 'person' or not (d.config ? 'default') then
    return null;
  end if;
  who := case when d.config ->> 'default' = 'me' then auth.uid()::text else d.config ->> 'default' end;
  if who is null then
    return null;
  end if;
  return case when d.config ? 'limit' then to_jsonb(who) else jsonb_build_array(who) end;
end $function$;

-- 3. Defaults for new rows -------------------------------------------------

create or replace function public.apply_property_defaults()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare d public.property_defs; dv jsonb;
begin
  if new.database_id is null then
    return new;
  end if;
  for d in
    select * from public.property_defs
     where database_id = new.database_id and archived_at is null and config ? 'default'
  loop
    if coalesce(new.props, '{}'::jsonb) -> d.key is null
       or coalesce(new.props, '{}'::jsonb) -> d.key = 'null'::jsonb then
      dv := public.property_default_value(d);
      if dv is not null then
        new.props := coalesce(new.props, '{}'::jsonb) || jsonb_build_object(d.key, dv);
      end if;
    end if;
  end loop;
  return new;
end $function$;

create trigger pages_0c_defaults
  before insert on public.pages
  for each row execute function public.apply_property_defaults();

-- 2 & 3. Checking person values and owners-only properties -----------------

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
    -- Owners-only properties: a new row may start with the default.
    if d.config ->> 'access' = 'owners'
       and auth.uid() is not null
       and not public.is_owner(new.workspace_id)
       and not (tg_op = 'INSERT' and v is not distinct from public.property_default_value(d)) then
      raise exception 'Only workspace owners can change "%".', d.label using errcode = '42501';
    end if;
    case d.type::text
      when 'multi_select' then
        if jsonb_typeof(v) <> 'array' then raise exception '% must be an array', k; end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then raise exception '% must be a boolean', k; end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' then raise exception '% must be a number', k; end if;
      when 'person' then
        if jsonb_typeof(v) = 'string' then
          if cardinality(public.person_ids(v)) <> 1 then
            raise exception '% must be a person', k using errcode = '23514';
          end if;
        elsif jsonb_typeof(v) = 'array' then
          if jsonb_array_length(v) > 50 or cardinality(public.person_ids(v)) <> jsonb_array_length(v) then
            raise exception '% must be a list of people', k using errcode = '23514';
          end if;
          if d.config ? 'limit' and jsonb_array_length(v) > 1 then
            raise exception '% holds one person', d.label using errcode = '23514';
          end if;
        else
          raise exception '% must be a person', k using errcode = '23514';
        end if;
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
      when 'formula' then
        raise exception '% is worked out by its formula, so it can''t be set directly', k
          using errcode = '23514';
      when 'unique_id' then
        raise exception '% is numbered automatically, so it can''t be set directly', k
          using errcode = '23514';
      when 'files' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 50 then
          raise exception '% must be a list of files', k using errcode = '23514';
        end if;
        if exists (
          select 1 from jsonb_array_elements(v) e
           where jsonb_typeof(e) <> 'object'
              or jsonb_typeof(e -> 'path') is distinct from 'string'
              or length(e ->> 'path') > 1024
              or jsonb_typeof(e -> 'name') is distinct from 'string'
              or length(e ->> 'name') > 255
              or exists (select 1 from jsonb_object_keys(e) f where f not in ('path', 'name', 'size', 'mime'))
        ) then
          raise exception '% must be a list of files', k using errcode = '23514';
        end if;
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

-- 3. Notifying people added to a person property ---------------------------

create or replace function public.notify_person_added()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
  d record;
  u uuid;
begin
  if actor is null or new.database_id is null or new.deleted_at is not null
     or coalesce(current_setting('gio.quiet_people', true), '') = 'on' then
    return new;
  end if;
  -- A notification must never cost anyone their edit.
  begin
    for d in
      select key, label from public.property_defs
       where database_id = new.database_id and type::text = 'person' and archived_at is null
         and coalesce((config ->> 'notify')::boolean, true)
    loop
      for u in
        select unnest(public.person_ids(new.props -> d.key))
        except
        select unnest(case when tg_op = 'UPDATE' then public.person_ids(old.props -> d.key) else '{}'::uuid[] end)
      loop
        continue when u = actor;
        continue when not public.user_can_read_page(new.id, u);
        continue when exists (
          select 1 from public.notifications x
           where x.user_id = u and x.page_id = new.id and x.kind = 'person_added'
             and x.read_at is null and x.created_at > now() - interval '10 minutes');
        insert into public.notifications (workspace_id, user_id, actor_id, kind, page_id, excerpt)
        values (new.workspace_id, u, actor, 'person_added', new.id, left(d.label, 300));
      end loop;
    end loop;
  exception when others then
    raise warning 'notify_person_added skipped for page %: %', new.id, sqlerrm;
  end;
  return new;
end $function$;

create trigger pages_notify_people
  after insert or update of props on public.pages
  for each row execute function public.notify_person_added();

-- 4. Changing a property's type with its values ----------------------------

create table if not exists public.property_type_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  def_id uuid not null,
  old_type public.property_type not null,
  new_type public.property_type not null,
  old_config jsonb not null default '{}'::jsonb,
  old_options jsonb not null default '[]'::jsonb,
  old_open_values boolean not null default false,
  -- Every value it had, by page id.
  old_values jsonb not null default '{}'::jsonb,
  changed_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

alter table public.property_type_changes enable row level security;

create policy property_type_changes_read_own on public.property_type_changes
  for select using (changed_by = (select auth.uid()));

-- The words a value says, in the old type: what conversion reads.
create or replace function public.prop_value_words(v jsonb, d public.property_defs)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  out text[] := '{}';
  e jsonb;
  t text := d.type::text;
  lbl text;
begin
  if v is null or v = 'null'::jsonb then
    return out;
  end if;
  if t in ('select', 'status') then
    select o ->> 'label' into lbl
      from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o
     where o ->> 'value' = v #>> '{}' limit 1;
    return array[coalesce(lbl, v #>> '{}')];
  elsif t = 'multi_select' then
    for e in select * from jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) loop
      out := out || (e #>> '{}');
    end loop;
    return out;
  elsif t = 'checkbox' then
    return case when v = 'true'::jsonb then array['Yes'] else '{}'::text[] end;
  elsif t = 'person' then
    select coalesce(array_agg(coalesce(nullif(btrim(pr.full_name), ''), pr.email, x::text)), '{}')
      into out
      from unnest(public.person_ids(v)) x
      left join public.profiles pr on pr.id = x;
    return out;
  elsif t = 'files' then
    for e in select * from jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) loop
      if e ? 'name' then out := out || (e ->> 'name'); end if;
    end loop;
    return out;
  elsif jsonb_typeof(v) in ('string', 'number', 'boolean') then
    return array[v #>> '{}'];
  end if;
  return out;
end $function$;

-- The same words, as a value of the new type (null when they don't read
-- as one). Choice options are passed in, already made.
create or replace function public.prop_value_from_words(
  words text[], t text, opts jsonb, ws uuid, one_person boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  w text := nullif(btrim(coalesce(words[1], '')), '');
  n text;
  ids text[];
begin
  if cardinality(words) = 0 then
    return null;
  end if;
  case t
    when 'text' then
      return to_jsonb(left(array_to_string(words, ', '), 4000));
    when 'number' then
      n := regexp_replace(coalesce(w, ''), '[,$%\s]', '', 'g');
      if n ~ '^-?\d+(\.\d+)?$' then return to_jsonb(n::numeric); end if;
      return null;
    when 'select', 'status' then
      if w is null then return null; end if;
      return (select to_jsonb(o ->> 'value') from jsonb_array_elements(opts) o
               where lower(o ->> 'label') = lower(left(w, 60)) limit 1);
    when 'multi_select' then
      return (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                from (select btrim(unnest(string_to_array(array_to_string(words, ','), ','))) x) s
               where x <> '');
    when 'date' then
      if w ~ '^\d{4}-\d{2}-\d{2}(/\d{4}-\d{2}-\d{2})?$' then return to_jsonb(w); end if;
      return null;
    when 'checkbox' then
      if lower(coalesce(w, '')) in ('yes', 'true', '1', 'x', 'checked', 'done', 'y', 'si', 'sí') then
        return 'true'::jsonb;
      end if;
      return null;
    when 'url' then
      if w is not null and length(w) <= 2048 and w ~ '^(https?://|www\.)\S+$' then return to_jsonb(w); end if;
      return null;
    when 'email' then
      if w ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return to_jsonb(w); end if;
      return null;
    when 'phone' then
      if w ~ '^\+?[0-9 ().-]{4,32}$' then return to_jsonb(w); end if;
      return null;
    when 'person' then
      select array_agg(distinct m.user_id::text) into ids
        from public.workspace_members m
        left join public.profiles pr on pr.id = m.user_id
       where m.workspace_id = ws
         and exists (select 1 from unnest(words) x
                      where lower(btrim(x)) in (lower(coalesce(pr.full_name, '')), lower(coalesce(pr.email, '')),
                                                m.user_id::text));
      if ids is null then return null; end if;
      if one_person then return to_jsonb(ids[1]); end if;
      return to_jsonb(ids);
    else
      return null;
  end case;
end $function$;

create or replace function public.change_property_type(p_def uuid, p_type text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d public.property_defs;
  uid uuid := auth.uid();
  f text;
  blocked int;
  snap jsonb;
  cid uuid;
  opts jsonb := '[]'::jsonb;
  w text;
  base text;
  v text;
  i int;
  nhash int;
  tints text[] := array['accentTint','amberTint','blueTint','purpleTint','pinkTint','yellowTint'];
  inks  text[] := array['accent','amberInk','blueInk','purple','pinkInk','yellowInk'];
  dots  text[] := array['accentDot','amberDot','blue','purple','pink','yellowInk'];
  old_opt jsonb;
  r record;
  nv jsonb;
  converted int := 0;
  cleared int := 0;
begin
  if uid is null then
    raise exception 'Sign in to change a property.' using errcode = '42501';
  end if;
  select * into d from public.property_defs where id = p_def for update;
  if d.id is null or not public.is_member(d.workspace_id) then
    raise exception 'That property isn''t available.' using errcode = 'P0002';
  end if;
  if d.is_system then
    raise exception 'Built-in properties keep their type.' using errcode = 'check_violation';
  end if;
  if not (public.is_owner(d.workspace_id)
          or (d.database_id is not null and public.can_edit_page(d.database_id))) then
    raise exception 'You can''t change this database''s properties.' using errcode = '42501';
  end if;
  if d.config ->> 'access' = 'owners' and not public.is_owner(d.workspace_id) then
    raise exception 'Only workspace owners can change "%".', d.label using errcode = '42501';
  end if;
  f := d.type::text;
  if f in ('relation', 'rollup', 'formula', 'unique_id', 'links') then
    raise exception 'A % property can''t change type. Add a new property of the type you need.',
      replace(f, '_', ' ') using errcode = 'check_violation';
  end if;
  if p_type not in ('text', 'number', 'select', 'multi_select', 'status', 'date', 'person',
                    'checkbox', 'url', 'email', 'phone', 'files') then
    raise exception 'A property can''t become that type here.' using errcode = '22023';
  end if;
  if p_type = f then
    return jsonb_build_object('change_id', null, 'converted', 0, 'cleared', 0);
  end if;

  -- Every value it holds, wherever it is (keys are unique per workspace).
  select count(*) into blocked
    from public.pages p
   where p.workspace_id = d.workspace_id
     and p.props ? d.key and p.props -> d.key <> 'null'::jsonb
     and not public.can_edit_page_row(p);
  if blocked > 0 then
    raise exception '% % you can''t edit % values for "%", so its type can''t change.',
      blocked, case when blocked = 1 then 'row' else 'rows' end,
      case when blocked = 1 then 'has' else 'have' end, d.label
      using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(p.id::text, p.props -> d.key), '{}'::jsonb) into snap
    from public.pages p
   where p.workspace_id = d.workspace_id
     and p.props ? d.key and p.props -> d.key <> 'null'::jsonb;

  insert into public.property_type_changes
    (workspace_id, def_id, old_type, new_type, old_config, old_options, old_open_values, old_values, changed_by)
  values
    (d.workspace_id, d.id, d.type, p_type::public.property_type, d.config, coalesce(d.options, '[]'::jsonb),
     coalesce(d.open_values, false), snap, uid)
  returning id into cid;

  -- Nobody hears about people moved in by a change of type.
  perform set_config('gio.quiet_people', 'on', true);

  -- 1. The values come off.
  update public.pages p
     set props = p.props - d.key
   where p.workspace_id = d.workspace_id and p.props ? d.key;

  -- 2. Options for a select or status: one per different word, in the
  --    order they first appear; an option the old property had keeps
  --    its colour.
  if p_type in ('select', 'status') then
    for w in
      select u.word
        from (
          select distinct btrim(x.word) as word
            from jsonb_each(snap) e
            cross join lateral unnest(public.prop_value_words(e.value, d)) as x(word)
           where btrim(x.word) <> ''
        ) u
       order by coalesce((select o.n from jsonb_array_elements(coalesce(d.options, '[]'::jsonb))
                                  with ordinality as o(opt, n)
                           where lower(o.opt ->> 'label') = lower(u.word) limit 1), 100000),
                lower(u.word), u.word collate "C"
       limit 100
    loop
      continue when exists (select 1 from jsonb_array_elements(opts) o where lower(o ->> 'label') = lower(left(w, 60)));
      base := lower(translate(left(w, 60), 'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÇç', 'AEIOUUNaeiouunAEIOUaeiouAEIOUaeiouCc'));
      base := btrim(regexp_replace(base, '[^a-z0-9]+', '_', 'g'), '_');
      if base = '' then base := 'option'; end if;
      v := base;
      i := 2;
      while exists (select 1 from jsonb_array_elements(opts) o where o ->> 'value' = v) loop
        v := base || '_' || i;
        i := i + 1;
      end loop;
      select o into old_opt from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o
       where lower(o ->> 'label') = lower(w) limit 1;
      nhash := (abs(hashtext(w)) % 6) + 1;
      opts := opts || jsonb_build_array(jsonb_build_object(
        'value', v,
        'label', left(w, 60),
        'tint', coalesce(old_opt ->> 'tint', tints[nhash]),
        'ink', coalesce(old_opt ->> 'ink', inks[nhash]),
        'dot', coalesce(old_opt ->> 'dot', dots[nhash])));
    end loop;
  end if;

  update public.property_defs
     set type = p_type::public.property_type,
         options = case when p_type in ('select', 'status') then opts else '[]'::jsonb end,
         open_values = false
   where id = d.id;

  -- 3. The values go back on, read in the new type. Only rows of its own
  --    database get one; one that won't read is left empty.
  for r in
    select e.key::uuid as page_id, e.value
      from jsonb_each(snap) e
      join public.pages p on p.id = e.key::uuid
     where p.database_id = d.database_id
  loop
    nv := public.prop_value_from_words(public.prop_value_words(r.value, d), p_type, opts,
                                       d.workspace_id, false);
    if nv is null or nv = '[]'::jsonb then
      cleared := cleared + 1;
      continue;
    end if;
    begin
      update public.pages p
         set props = p.props || jsonb_build_object(d.key, nv)
       where p.id = r.page_id;
      converted := converted + 1;
    exception when others then
      cleared := cleared + 1;
    end;
  end loop;

  perform set_config('gio.quiet_people', 'off', true);
  return jsonb_build_object('change_id', cid, 'converted', converted, 'cleared', cleared);
end $function$;

create or replace function public.undo_property_type_change(p_change uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.property_type_changes;
  d public.property_defs;
  r record;
begin
  select * into c from public.property_type_changes
   where id = p_change for update;
  if c.id is null or c.changed_by is distinct from auth.uid() or c.undone_at is not null
     or c.created_at < now() - interval '1 hour' then
    raise exception 'This change can no longer be undone.' using errcode = 'P0002';
  end if;
  select * into d from public.property_defs where id = c.def_id for update;
  if d.id is null or d.type <> c.new_type then
    raise exception 'The property has changed since, so this can''t be undone.' using errcode = 'P0002';
  end if;

  perform set_config('gio.quiet_people', 'on', true);

  update public.pages p
     set props = p.props - d.key
   where p.workspace_id = d.workspace_id and p.props ? d.key;

  update public.property_defs
     set type = c.old_type,
         config = c.old_config,
         options = c.old_options,
         open_values = c.old_open_values
   where id = d.id;

  for r in select e.key::uuid as page_id, e.value from jsonb_each(c.old_values) e loop
    begin
      update public.pages p
         set props = p.props || jsonb_build_object(d.key, r.value)
       where p.id = r.page_id;
    exception when others then
      raise warning 'undo_property_type_change: page % kept no value: %', r.page_id, sqlerrm;
    end;
  end loop;

  update public.property_type_changes set undone_at = now() where id = c.id;
  perform set_config('gio.quiet_people', 'off', true);
end $function$;

revoke all on function public.change_property_type(uuid, text) from public;
revoke all on function public.undo_property_type_change(uuid) from public;
grant execute on function public.change_property_type(uuid, text) to authenticated;
grant execute on function public.undo_property_type_change(uuid) to authenticated;
revoke all on function public.prop_value_words(jsonb, public.property_defs) from public;
revoke all on function public.prop_value_from_words(text[], text, jsonb, uuid, boolean) from public;
