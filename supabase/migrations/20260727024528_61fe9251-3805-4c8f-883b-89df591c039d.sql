alter table public.property_defs
  add column if not exists open_values boolean not null default false;

update public.property_defs set open_values = true where key = 'area';

create or replace function public.validate_page_props()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare k text; d public.property_defs; v jsonb;
begin
  for k in select jsonb_object_keys(new.props) loop
    select * into d from public.property_defs
     where workspace_id = new.workspace_id and key = k;
    if d.id is null then
      raise exception 'Unknown property "%". Register it in property_defs first.', k
        using errcode='23514';
    end if;
    v := new.props -> k;
    if v = 'null'::jsonb then continue; end if;
    case d.type
      when 'multi_select' then
        if jsonb_typeof(v) <> 'array' then raise exception '% must be an array', k; end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then raise exception '% must be a boolean', k; end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' then raise exception '% must be a number', k; end if;
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
      else null;
    end case;
  end loop;
  return new;
end $function$;
