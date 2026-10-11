-- More property types (Allan, 2026-10-11), Notion's: Unique ID, Files &
-- media and Formula; number formats; status groups.
--
-- * Unique ID shows a row's number in its database, with an optional
--   prefix (REQ-104). The number is pages.row_number, given by the database
--   when a row is made or moves into a database (the next after the
--   highest it ever gave, deleted rows included) and never set by the app.
--   The property stores nothing.
-- * Files & media stores a list of {path, name, size, mime}; the files live
--   in the page-images bucket under the row's own folder, so who can open
--   the row is who can open its files.
-- * Formula stores nothing: config.expression is worked out in the app,
--   like a rollup.
-- * A number's config may say how it shows: format (number, comma,
--   percent, currency), decimals (0-6) and currency.
-- * A status option may carry a group: todo, doing or done (Notion's
--   To-do / In progress / Complete), set one at a time like its colour.

alter type public.property_type add value if not exists 'unique_id';
alter type public.property_type add value if not exists 'files';
alter type public.property_type add value if not exists 'formula';

-- ─────────────── Row numbers ───────────────

alter table public.pages add column if not exists row_number integer;

update public.pages p
   set row_number = s.n
  from (select id, row_number() over (partition by database_id order by created_at, id) as n
          from public.pages where database_id is not null) s
 where p.id = s.id;

create or replace function public.assign_row_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.database_id is null then
    new.row_number := null;
    return new;
  end if;
  if tg_op = 'INSERT' or new.database_id is distinct from old.database_id then
    -- One number at a time per database.
    perform 1 from public.pages where id = new.database_id for update;
    select coalesce(max(row_number), 0) + 1 into new.row_number
      from public.pages where database_id = new.database_id;
  else
    new.row_number := old.row_number;
  end if;
  return new;
end $$;

revoke all on function public.assign_row_number() from public, anon;
grant execute on function public.assign_row_number() to authenticated, service_role;

-- After pages_0_database (which sets database_id), before the rest.
create trigger pages_0b_row_number
  before insert or update on public.pages
  for each row execute function public.assign_row_number();

-- ─────────────── Values ───────────────

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

-- ─────────────── Settings ───────────────

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
  elsif new.type::text = 'number' then
    if exists (select 1 from jsonb_object_keys(c) k where k not in ('format', 'decimals', 'currency'))
       or (c ? 'format' and (c ->> 'format') not in ('number', 'comma', 'percent', 'currency'))
       or (c ? 'decimals' and (jsonb_typeof(c -> 'decimals') <> 'number'
                               or (c ->> 'decimals')::numeric not in (0, 1, 2, 3, 4, 5, 6)))
       or (c ? 'currency' and (c ->> 'currency') not in ('USD', 'MXN', 'EUR', 'GBP', 'CAD', 'BRL', 'COP')) then
      raise exception 'A number shows as number, comma, percent or currency, with 0 to 6 decimals.'
        using errcode = '23514';
    end if;
  elsif new.type::text = 'unique_id' then
    if exists (select 1 from jsonb_object_keys(c) k where k <> 'prefix')
       or (c ? 'prefix' and (jsonb_typeof(c -> 'prefix') <> 'string' or (c ->> 'prefix') !~ '^[A-Za-z0-9]{0,10}$')) then
      raise exception 'An ID''s prefix is up to 10 letters and digits.' using errcode = '23514';
    end if;
  elsif new.type::text = 'formula' then
    if exists (select 1 from jsonb_object_keys(c) k where k <> 'expression')
       or (c ? 'expression' and (jsonb_typeof(c -> 'expression') <> 'string' or length(c ->> 'expression') > 2000)) then
      raise exception 'A formula is one expression of up to 2000 characters.' using errcode = '23514';
    end if;
  elsif c <> '{}'::jsonb then
    raise exception 'Only relations, rollups, numbers, IDs and formulas have settings.' using errcode = '23514';
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

-- A type change keeps only the settings the new type has.
create or replace function public.reset_config_on_retype()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type is distinct from old.type and new.config is not distinct from old.config then
    new.config := '{}'::jsonb;
  end if;
  return new;
end $$;

create trigger property_defs_0_reset_config
  before update of type on public.property_defs
  for each row execute function public.reset_config_on_retype();

-- ─────────────── Status groups ───────────────

create or replace function public.set_property_option_group(p_def uuid, p_value text, p_group text)
returns void
language plpgsql
set search_path = public
as $$
declare d public.property_defs := public.lock_option_def(p_def);
begin
  if d.type::text <> 'status' then
    raise exception 'Only a status groups its options.' using errcode = '22023';
  end if;
  if p_group not in ('todo', 'doing', 'done') then
    raise exception 'A status option is To-do, In progress or Complete.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o where o ->> 'value' = p_value
  ) then
    raise exception 'That option no longer exists.' using errcode = 'P0002';
  end if;
  update public.property_defs
     set options = (
       select coalesce(jsonb_agg(
                case when o ->> 'value' = p_value then o || jsonb_build_object('group', p_group) else o end
                order by ord), '[]'::jsonb)
         from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) with ordinality as t(o, ord)
     )
   where id = p_def;
end $$;

revoke all on function public.set_property_option_group(uuid, text, text) from public, anon;
grant execute on function public.set_property_option_group(uuid, text, text) to authenticated, service_role;

