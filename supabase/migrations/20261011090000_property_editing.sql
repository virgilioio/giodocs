-- Editing a property from its column (Allan, 2026-10-11): option colours,
-- option order, removing an unused option, and duplicating a property with
-- its values.
--
-- Options still change one at a time, under a row lock, as the caller (RLS
-- decides who can change the property: anyone who can edit its database,
-- or a workspace owner). guard_property_def still refuses removing an
-- option pages use. Colours are palette NAMES mapped to the app's tokens
-- here, never raw colours.

create or replace function public.option_palette(p_color text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case p_color
    when 'gray'   then '{"tint":"sunken","ink":"secondary","dot":"whisper"}'::jsonb
    when 'green'  then '{"tint":"accentTint","ink":"accent","dot":"accentDot"}'::jsonb
    when 'amber'  then '{"tint":"amberTint","ink":"amberInk","dot":"amberDot"}'::jsonb
    when 'yellow' then '{"tint":"yellowTint","ink":"yellowInk","dot":"yellowInk"}'::jsonb
    when 'blue'   then '{"tint":"blueTint","ink":"blueInk","dot":"blue"}'::jsonb
    when 'purple' then '{"tint":"purpleTint","ink":"purple","dot":"purple"}'::jsonb
    when 'pink'   then '{"tint":"pinkTint","ink":"pinkInk","dot":"pink"}'::jsonb
    when 'red'    then '{"tint":"dangerTint","ink":"danger","dot":"dangerDot"}'::jsonb
    else null
  end
$$;

create or replace function public.lock_option_def(p_def uuid)
returns public.property_defs
language plpgsql
set search_path = public
as $$
declare d public.property_defs;
begin
  select * into d from public.property_defs where id = p_def for update;
  if d.id is null then
    raise exception 'That property isn''t available.' using errcode = 'P0002';
  end if;
  if d.type::text not in ('select', 'status') then
    raise exception 'Only selects and statuses have options.' using errcode = '22023';
  end if;
  if d.is_system and not public.is_owner(d.workspace_id) then
    raise exception 'Built-in properties keep their options.' using errcode = '42501';
  end if;
  return d;
end $$;

-- An option's colour, by palette name.
create or replace function public.set_property_option_color(p_def uuid, p_value text, p_color text)
returns void
language plpgsql
set search_path = public
as $$
declare
  d public.property_defs := public.lock_option_def(p_def);
  pal jsonb := public.option_palette(p_color);
begin
  if pal is null then
    raise exception 'Pick one of the palette colours.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o where o ->> 'value' = p_value
  ) then
    raise exception 'That option no longer exists.' using errcode = 'P0002';
  end if;
  update public.property_defs
     set options = (
       select coalesce(jsonb_agg(
                case when o ->> 'value' = p_value then o || pal else o end
                order by ord), '[]'::jsonb)
         from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) with ordinality as t(o, ord)
     )
   where id = p_def;
end $$;

-- Moves an option to a place in the list (0 = first). Order is how boards
-- lay out their columns and how sorting reads the options.
create or replace function public.move_property_option(p_def uuid, p_value text, p_to int)
returns void
language plpgsql
set search_path = public
as $$
declare
  d public.property_defs := public.lock_option_def(p_def);
  moving jsonb;
  rest jsonb;
  n int;
  at int;
begin
  select o into moving
    from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o
   where o ->> 'value' = p_value
   limit 1;
  if moving is null then
    raise exception 'That option no longer exists.' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(o order by ord), '[]'::jsonb) into rest
    from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) with ordinality as t(o, ord)
   where o ->> 'value' <> p_value;
  n := jsonb_array_length(rest);
  at := greatest(0, least(coalesce(p_to, n), n));
  update public.property_defs
     set options = (
       select coalesce(jsonb_agg(x order by i), '[]'::jsonb)
         from (
           select o as x, (ord - 1) + case when ord - 1 >= at then 1 else 0 end as i
             from jsonb_array_elements(rest) with ordinality as t(o, ord)
           union all
           select moving, at
         ) s
     )
   where id = p_def;
end $$;

-- Removes an option no page uses (guard_property_def refuses one in use).
create or replace function public.remove_property_option(p_def uuid, p_value text)
returns void
language plpgsql
set search_path = public
as $$
declare d public.property_defs := public.lock_option_def(p_def);
begin
  update public.property_defs
     set options = (
       select coalesce(jsonb_agg(o order by ord), '[]'::jsonb)
         from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) with ordinality as t(o, ord)
        where o ->> 'value' <> p_value
     )
   where id = p_def;
end $$;

-- A copy of a property in the same database, named "<label> (copy)", with
-- the values of every row the caller can edit. A two-way relation is
-- copied one way; the far side of one can't be copied (it stores nothing).
create or replace function public.duplicate_property(p_def uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.property_defs;
  base text;
  k text;
  i int := 2;
  cfg jsonb;
  label text;
  made uuid;
  copied int;
begin
  select * into d from public.property_defs where id = p_def;
  if d.id is null or d.archived_at is not null or d.database_id is null then
    raise exception 'That property isn''t available.' using errcode = 'P0002';
  end if;
  if not public.is_member(d.workspace_id)
     or not (public.is_owner(d.workspace_id) or public.can_edit_page(d.database_id)) then
    raise exception 'Only people who can edit this database can copy its properties.'
      using errcode = '42501';
  end if;
  if d.is_system then
    raise exception 'Built-in properties can''t be copied.' using errcode = 'check_violation';
  end if;
  cfg := coalesce(d.config, '{}'::jsonb);
  if cfg ? 'of' then
    raise exception 'This is the other side of a relation; copy the relation it belongs to instead.'
      using errcode = 'check_violation';
  end if;
  cfg := cfg - 'back';

  base := left(d.key, 25) || '_copy';
  k := base;
  while exists (select 1 from public.property_defs where workspace_id = d.workspace_id and key = k) loop
    k := base || '_' || i;
    i := i + 1;
  end loop;
  label := left(d.label, 70) || ' (copy)';

  insert into public.property_defs
    (workspace_id, database_id, key, label, type, options, open_values, is_system, position, created_by, config)
  values
    (d.workspace_id, d.database_id, k, label, d.type, coalesce(d.options, '[]'::jsonb),
     coalesce(d.open_values, false), false, coalesce(d.position, 0), auth.uid(), cfg)
  returning id into made;

  -- Rollups are worked out, never stored: nothing to copy.
  copied := 0;
  if d.type::text <> 'rollup' then
    update public.pages p
       set props = p.props || jsonb_build_object(k, p.props -> d.key)
     where p.database_id = d.database_id
       and p.deleted_at is null
       and p.props ? d.key
       and p.props -> d.key <> 'null'::jsonb
       and public.can_edit_page_row(p);
    get diagnostics copied = row_count;
  end if;
  return jsonb_build_object('id', made, 'key', k, 'label', label, 'rows', copied);
end $$;

revoke all on function public.option_palette(text) from public, anon;
grant execute on function public.option_palette(text) to authenticated, service_role;
revoke all on function public.lock_option_def(uuid) from public, anon;
grant execute on function public.lock_option_def(uuid) to authenticated, service_role;
revoke all on function public.set_property_option_color(uuid, text, text) from public, anon;
grant execute on function public.set_property_option_color(uuid, text, text) to authenticated, service_role;
revoke all on function public.move_property_option(uuid, text, int) from public, anon;
grant execute on function public.move_property_option(uuid, text, int) to authenticated, service_role;
revoke all on function public.remove_property_option(uuid, text) from public, anon;
grant execute on function public.remove_property_option(uuid, text) to authenticated, service_role;
revoke all on function public.duplicate_property(uuid) from public, anon;
grant execute on function public.duplicate_property(uuid) to authenticated, service_role;
