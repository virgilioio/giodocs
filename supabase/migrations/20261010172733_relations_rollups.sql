-- Relations and rollups (2026-10-10, Phase 2).
--
-- A relation property links a page to other pages: its value is a list of
-- page ids. Its settings live in property_defs.config:
--   relation  { "view_id": uuid | null,  -- offer only that view's pages
--               "back": key | null }     -- its two-way partner, if any
--   the far side of a two-way relation  { "of": key }
--             It holds no values: which pages link here is worked out from
--             the near side, so the two sides can never disagree.
--   rollup    { "relation": key, "target": key, "calc": text }
--             A figure worked out from the related pages; no values either.
-- Reading still goes through RLS: a linked page someone can't open is not
-- in their page list, so it never shows or counts for them.

alter type public.property_type add value if not exists 'relation';
alter type public.property_type add value if not exists 'rollup';

alter table public.property_defs
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.property_defs
  add constraint property_defs_config_shape
  check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 4096);

-- The settings each kind takes, and the partner of a two-way relation
-- can't be re-pointed (its pages would silently change meaning).
create or replace function public.guard_property_config()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare c jsonb := new.config;
begin
  if new.type::text = 'relation' then
    if exists (select 1 from jsonb_object_keys(c) k where k not in ('view_id', 'back', 'of')) then
      raise exception 'A relation''s settings are view_id, back and of.' using errcode = '23514';
    end if;
    if c ? 'view_id' and jsonb_typeof(c -> 'view_id') <> 'null'
       and (c ->> 'view_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'view_id must be a view.' using errcode = '23514';
    end if;
    if (c ? 'of' and (c ->> 'of') !~ '^[a-z][a-z0-9_]{0,30}$')
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

  if tg_op = 'UPDATE' and (old.config ->> 'of') is distinct from (new.config ->> 'of') then
    raise exception 'The far side of a relation stays paired with its relation.' using errcode = '23514';
  end if;
  return new;
end $function$;

create trigger property_defs_guard_config
  before insert or update of config, type on public.property_defs
  for each row execute function public.guard_property_config();

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
    select * into d from public.property_defs
     where workspace_id = new.workspace_id and key = k;
    if d.id is null then
      raise exception 'Unknown property "%". Register it in property_defs first.', k
        using errcode='23514';
    end if;
    v := new.props -> k;
    if v = 'null'::jsonb then continue; end if;
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
          -- Both ends must be real days, the end on or after the start.
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
        -- The far side of a two-way relation is worked out from the near
        -- side; it never holds values of its own.
        if d.config ? 'of' then
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
