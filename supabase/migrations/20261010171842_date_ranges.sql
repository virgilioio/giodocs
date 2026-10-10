-- Date ranges (2026-10-10, Phase 2).
--
-- A date property holds one calendar day, "2026-10-12", or a range written
-- as ISO 8601 start/end, "2026-10-12/2026-10-15", with the end on or after
-- the start. Until now date values weren't checked at all; this checks the
-- ones an update changes (as for every other type). An older value written
-- as a timestamp ("2026-08-15T00:00:00Z") is still accepted, so copying a
-- page that holds one keeps working.

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
