-- Options can't vanish from under pages, and option edits are one at a time.
--
-- Found in review (2026-10-10):
-- 1. validate_page_props re-checked EVERY property on every props update, so
--    a page holding a value that had since become invalid (an option renamed
--    or removed elsewhere) rejected every later edit to any of its
--    properties. Now an update checks only the properties it changes.
-- 2. Nothing stopped an options update from dropping a value pages use.
--    guard_property_def now refuses that for selects and statuses whose
--    values are checked against their options (not open-valued ones like
--    Area).
-- 3. Options were written as a whole list from the browser, so two people
--    editing at once could erase each other's changes. Adding and renaming
--    now go through add_property_option / rename_property_option, which lock
--    the row and change one option.
-- Built-in properties keep their option list for members (owners can still
-- change it); Area's own flows are unaffected (open-valued, and they write
-- the table directly as before).

-- 1. Check only what changed.
create or replace function public.validate_page_props()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare k text; d public.property_defs; v jsonb;
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

-- 2. The guard also protects option values pages use.
create or replace function public.guard_property_def()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  in_use boolean;
  gone text;
begin
  if tg_op = 'DELETE' then
    select exists (
      select 1 from pages p
       where p.workspace_id = old.workspace_id
         and p.props ? old.key
         and p.props -> old.key <> 'null'::jsonb
    ) into in_use;
    if in_use then
      raise exception 'Pages still have values for "%". Archive it instead; the values stay.', old.label
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.key is distinct from old.key then
    raise exception 'A property''s key can''t change. Rename its label instead.'
      using errcode = 'check_violation';
  end if;
  if new.workspace_id is distinct from old.workspace_id
     or new.is_system is distinct from old.is_system
     -- created_by may only be cleared (its profile was deleted).
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception 'That can''t change on a property.'
      using errcode = 'check_violation';
  end if;

  if new.archived_at is distinct from old.archived_at then
    if old.is_system then
      raise exception 'Built-in properties can''t be archived.'
        using errcode = 'check_violation';
    end if;
    if not public.is_owner(old.workspace_id) then
      raise exception 'Only workspace owners can archive or restore properties.'
        using errcode = '42501';
    end if;
  end if;

  if new.type is distinct from old.type then
    if old.is_system then
      raise exception 'Built-in properties keep their type.'
        using errcode = 'check_violation';
    end if;
    select exists (
      select 1 from pages p
       where p.workspace_id = old.workspace_id
         and p.props ? old.key
         and p.props -> old.key <> 'null'::jsonb
    ) into in_use;
    if in_use then
      raise exception 'Pages already have values for "%", so its type can''t change.', old.label
        using errcode = 'check_violation';
    end if;
  end if;

  -- An option value pages use can't disappear (renaming keeps the value).
  -- Only where values are checked against options: selects that aren't
  -- open-valued, and statuses.
  if new.options is distinct from old.options
     and (old.type::text = 'status' or (old.type::text = 'select' and not coalesce(old.open_values, false))) then
    select o ->> 'value' into gone
      from jsonb_array_elements(coalesce(old.options, '[]'::jsonb)) o
     where not exists (
             select 1 from jsonb_array_elements(coalesce(new.options, '[]'::jsonb)) n
              where n ->> 'value' = o ->> 'value')
       and exists (
             select 1 from pages p
              where p.workspace_id = old.workspace_id
                and p.props ->> old.key = o ->> 'value')
     limit 1;
    if gone is not null then
      raise exception 'Pages use the option "%" of "%", so it can''t be removed.', gone, old.label
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

-- 3. One option at a time, under a row lock.
create or replace function public.add_property_option(p_def uuid, p_label text)
returns text
language plpgsql
set search_path = public
as $$
declare
  d public.property_defs;
  clean text := btrim(coalesce(p_label, ''));
  base text;
  v text;
  i int := 2;
  hit text;
  tints text[] := array['accentTint','amberTint','blueTint','purpleTint','pinkTint','yellowTint'];
  inks  text[] := array['accent','amberInk','blueInk','purple','pinkInk','yellowInk'];
  n int;
begin
  -- Runs as the caller: RLS decides who can read and lock the row.
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
  if clean = '' then
    raise exception 'Give the option a name.' using errcode = '22023';
  end if;
  if length(clean) > 60 then
    raise exception 'Keep option names under 60 characters.' using errcode = '22023';
  end if;

  -- The same name again is the same option.
  select o ->> 'value' into hit
    from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o
   where lower(o ->> 'label') = lower(clean)
   limit 1;
  if hit is not null then
    return hit;
  end if;

  base := lower(translate(clean, 'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÇç', 'AEIOUUNaeiouunAEIOUaeiouAEIOUaeiouCc'));
  base := btrim(regexp_replace(base, '[^a-z0-9]+', '_', 'g'), '_');
  if base = '' then base := 'option'; end if;
  v := base;
  while exists (
    select 1 from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o where o ->> 'value' = v
  ) loop
    v := base || '_' || i;
    i := i + 1;
  end loop;

  n := (abs(hashtext(clean)) % 6) + 1;
  update public.property_defs
     set options = coalesce(options, '[]'::jsonb)
                   || jsonb_build_array(jsonb_build_object('value', v, 'label', clean, 'tint', tints[n], 'ink', inks[n]))
   where id = p_def;
  return v;
end $$;

create or replace function public.rename_property_option(p_def uuid, p_value text, p_label text)
returns void
language plpgsql
set search_path = public
as $$
declare
  d public.property_defs;
  clean text := btrim(coalesce(p_label, ''));
begin
  select * into d from public.property_defs where id = p_def for update;
  if d.id is null then
    raise exception 'That property isn''t available.' using errcode = 'P0002';
  end if;
  if d.is_system and not public.is_owner(d.workspace_id) then
    raise exception 'Built-in properties keep their options.' using errcode = '42501';
  end if;
  if clean = '' then
    raise exception 'An option needs a name.' using errcode = '22023';
  end if;
  if length(clean) > 60 then
    raise exception 'Keep option names under 60 characters.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o where o ->> 'value' = p_value
  ) then
    raise exception 'That option no longer exists.' using errcode = 'P0002';
  end if;

  -- Same order, same value; only this option's label changes.
  update public.property_defs
     set options = (
       select coalesce(jsonb_agg(
                case when o ->> 'value' = p_value
                     then jsonb_set(o, '{label}', to_jsonb(clean))
                     else o end
                order by ord), '[]'::jsonb)
         from jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) with ordinality as t(o, ord)
     )
   where id = p_def;
end $$;

revoke all on function public.add_property_option(uuid, text) from public, anon, authenticated;
grant execute on function public.add_property_option(uuid, text) to authenticated, service_role;
revoke all on function public.rename_property_option(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rename_property_option(uuid, text, text) to authenticated, service_role;
