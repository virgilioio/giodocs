-- Custom properties, owned by the team.
--
-- Decided by Allan, 2026-10-09: any member can create properties; only
-- workspace owners remove them. Removing is an ARCHIVE: the property is
-- hidden from pages and views, and every value stays, so nothing is lost and
-- an owner can bring it back. A property can only be deleted outright when
-- no page (not even a deleted one) has a value for it.
--
-- Also: three new property types (url, email, phone) and a calendar layout
-- for views. Relations between pages keep using the existing `links` type.

-- 1. New types and layout. (New enum values are not used in this file.)
alter type public.property_type add value if not exists 'url';
alter type public.property_type add value if not exists 'email';
alter type public.property_type add value if not exists 'phone';

-- A calendar view places pages by a date property, stored in views.group_by
-- (the property the layout is organised by — the select for a board, the
-- date for a calendar).
alter type public.view_layout add value if not exists 'calendar';

-- 2. Who made a property, and whether it is archived.
alter table public.property_defs
  add column if not exists created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

-- 3. Row level security: members create and edit, owners remove.
drop policy if exists propdefs_write on public.property_defs;
drop policy if exists propdefs_insert on public.property_defs;
drop policy if exists propdefs_update on public.property_defs;
drop policy if exists propdefs_delete on public.property_defs;

create policy propdefs_insert on public.property_defs for insert
  with check (
    public.is_member(workspace_id)
    and is_system = false
    and archived_at is null
    and created_by = (select auth.uid())
  );

create policy propdefs_update on public.property_defs for update
  using (public.is_member(workspace_id))
  with check (public.is_member(workspace_id));

create policy propdefs_delete on public.property_defs for delete
  using (public.is_owner(workspace_id) and is_system = false);

-- 4. The rules a policy can't express.
create or replace function public.guard_property_def()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  in_use boolean;
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

  return new;
end $$;

revoke all on function public.guard_property_def() from public, anon, authenticated;

drop trigger if exists property_defs_guard on public.property_defs;
create trigger property_defs_guard
  before update or delete on public.property_defs
  for each row execute function public.guard_property_def();

-- 5. Validate the new types. Same function as today plus url, email and
--    phone; values of archived properties are still accepted (they stay on
--    the page, hidden).
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
