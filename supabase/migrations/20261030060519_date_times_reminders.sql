-- Dates with a time, and reminders (C5, Allan 2026-10-30).
--
-- 1. A date property may hold a time: one moment written with the writer's
--    offset and no seconds ("2026-10-31T09:00-05:00"), or a range of them
--    (start/end). A single one was already accepted; validate_page_props
--    now accepts timed ranges too. Nothing else about values changes.
--
-- 2. Reminders. date_reminders holds one per person, page and date
--    property: when to remind (remind), relative to the date, and the time
--    zone a day without a time is read in (9:00 there). set_date_reminder
--    sets or clears the caller's own (only on a page they can open, only on
--    a date property). A change to the date moves its reminders
--    (pages_reschedule_reminders). Every minute, deliver_date_reminders
--    files due ones in the Inbox (notifications, kind date_reminder) of the
--    person who set it and, in a task database, the row's assignee: only
--    people who can open the page, never for an archived, template or
--    finished row, and never for a moment that had already passed when the
--    reminder was set. A failure there never touches a page save.
--
-- 3. pg_cron runs the delivery. The extension is switched on here.
--
-- Rows hold no foreign keys to pages or users: a page or person that's
-- gone simply never matches the delivery's join, and nothing here can stop
-- a page from being purged.

create extension if not exists pg_cron with schema pg_catalog;

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
        -- A range of days, or of moments ("2026-10-31T09:00-05:00", a day
        -- and a time with its offset, 2026-10-30).
        if s ~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2}))?/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2}))?$' then
          if position('T' in s) > 0 then
            if split_part(s, '/', 2)::timestamptz < split_part(s, '/', 1)::timestamptz then
              raise exception '% ends before it starts', k using errcode = '23514';
            end if;
          elsif to_date(split_part(s, '/', 2), 'YYYY-MM-DD') < to_date(split_part(s, '/', 1), 'YYYY-MM-DD') then
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


create table public.date_reminders (
  page_id uuid not null,
  prop_key text not null,
  user_id uuid not null,
  workspace_id uuid not null references public.workspaces(id),
  -- at · m5 m10 m15 m30 · h1 h2 (before a time); d0 (the day, 9:00) ·
  -- d1 d2 · w1 (days before). Null: cleared.
  remind text check (remind in ('at', 'm5', 'm10', 'm15', 'm30', 'h1', 'h2', 'd0', 'd1', 'd2', 'w1')),
  tz text not null default 'UTC',
  remind_at timestamptz,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (page_id, prop_key, user_id)
);

create index date_reminders_due on public.date_reminders (remind_at)
  where remind is not null and sent_at is null;

alter table public.date_reminders enable row level security;

create policy date_reminders_read_own on public.date_reminders
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.date_reminders from anon, authenticated;
grant select on public.date_reminders to authenticated;
grant all on public.date_reminders to service_role;

-- When a reminder is due: before a moment, or at 9:00 in `tz` on (or days
-- before) a day. Null for anything that isn't a date.
create or replace function public.reminder_time(p_value text, p_remind text, p_tz text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  head text := split_part(coalesce(p_value, ''), '/', 1);
  t timestamptz;
  d date;
begin
  if p_remind is null or head = '' then
    return null;
  end if;
  if head ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$' then
    t := head::timestamptz;
    return t - case p_remind
      when 'm5' then interval '5 minutes'
      when 'm10' then interval '10 minutes'
      when 'm15' then interval '15 minutes'
      when 'm30' then interval '30 minutes'
      when 'h1' then interval '1 hour'
      when 'h2' then interval '2 hours'
      when 'd1' then interval '1 day'
      when 'd2' then interval '2 days'
      when 'w1' then interval '7 days'
      else interval '0'
    end;
  end if;
  d := to_date(left(head, 10), 'YYYY-MM-DD');
  return ((d - case p_remind when 'd1' then 1 when 'd2' then 2 when 'w1' then 7 else 0 end)
          + time '09:00') at time zone coalesce(nullif(p_tz, ''), 'UTC');
exception when others then
  return null;
end $$;

revoke all on function public.reminder_time(text, text, text) from public, anon, authenticated;

-- Set (or, with null, clear) my reminder of a page's date. Returns when it
-- will arrive.
create or replace function public.set_date_reminder(
  p_page uuid, p_key text, p_remind text, p_tz text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.pages;
  d public.property_defs;
  zone text := coalesce(nullif(p_tz, ''), 'UTC');
  due timestamptz;
begin
  if me is null then
    raise exception 'Sign in to set a reminder.' using errcode = '42501';
  end if;
  select * into p from public.pages where id = p_page and deleted_at is null;
  if p.id is null or not public.can_read_page(p_page) then
    raise exception 'You can''t open this page.' using errcode = '42501';
  end if;
  select * into d from public.property_defs
   where database_id = p.database_id and key = p_key and archived_at is null;
  if d.id is null or d.type::text <> 'date' then
    raise exception 'Reminders are for date properties.' using errcode = '23514';
  end if;
  if p_remind is not null
     and p_remind not in ('at', 'm5', 'm10', 'm15', 'm30', 'h1', 'h2', 'd0', 'd1', 'd2', 'w1') then
    raise exception 'Unknown reminder "%".', p_remind using errcode = '23514';
  end if;
  if not exists (select 1 from pg_timezone_names where name = zone) then
    zone := 'UTC';
  end if;
  due := public.reminder_time(p.props ->> p_key, p_remind, zone);
  insert into public.date_reminders
    (page_id, prop_key, user_id, workspace_id, remind, tz, remind_at, sent_at, updated_at)
  values (p_page, p_key, me, p.workspace_id, p_remind, zone, due, null, now())
  on conflict (page_id, prop_key, user_id) do update
    set remind = excluded.remind,
        tz = excluded.tz,
        remind_at = excluded.remind_at,
        sent_at = null,
        updated_at = now();
  return due;
end $$;

revoke all on function public.set_date_reminder(uuid, text, text, text) from public, anon;
grant execute on function public.set_date_reminder(uuid, text, text, text) to authenticated;

-- A changed date moves its reminders (and they may arrive again).
create or replace function public.reschedule_date_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.date_reminders r
       set remind_at = public.reminder_time(new.props ->> r.prop_key, r.remind, r.tz),
           sent_at = null,
           updated_at = now()
     where r.page_id = new.id
       and r.remind is not null
       and (old.props -> r.prop_key) is distinct from (new.props -> r.prop_key);
  exception when others then
    raise warning 'reschedule_date_reminders skipped for page %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

create trigger pages_reschedule_reminders
  after update of props on public.pages
  for each row
  when (old.props is distinct from new.props)
  execute function public.reschedule_date_reminders();

-- Is the row finished? Its task database says so (its done property holds
-- one of done_values, or is ticked), or a status of its database is in the
-- Complete group.
create or replace function public.page_is_finished(p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.pages p
      join public.pages db on db.id = p.database_id
     where p.id = p_page
       and db.task_config ? 'done'
       and (coalesce(db.task_config -> 'done_values', '[]'::jsonb) ? (p.props ->> (db.task_config ->> 'done'))
            -- A checkbox counts as done when it's ticked.
            or (p.props -> (db.task_config ->> 'done')) = 'true'::jsonb)
  ) or exists (
    select 1
      from public.pages p
      join public.property_defs d
        on d.database_id = p.database_id and d.type::text = 'status' and d.archived_at is null
     cross join lateral jsonb_array_elements(coalesce(d.options, '[]'::jsonb)) o
     where p.id = p_page
       and o ->> 'value' = p.props ->> d.key
       and o ->> 'group' in ('complete', 'done')
  );
$$;

revoke all on function public.page_is_finished(uuid) from public, anon, authenticated;

-- File due reminders in the Inbox. Run every minute by pg_cron.
create or replace function public.deliver_date_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  cfg jsonb;
  prop_label text;
  who uuid;
  filed integer := 0;
begin
  for r in
    select dr.page_id, dr.prop_key, dr.user_id, p.workspace_id, p.database_id, p.props,
           p.archived_at, p.template_at
      from public.date_reminders dr
      join public.pages p on p.id = dr.page_id and p.deleted_at is null
     where dr.remind is not null
       and dr.sent_at is null
       and dr.remind_at <= now()
       and dr.remind_at > now() - interval '1 day'
       and dr.remind_at >= dr.updated_at - interval '1 minute'
     order by dr.remind_at
     limit 500
     for update of dr skip locked
  loop
    update public.date_reminders
       set sent_at = now()
     where page_id = r.page_id and prop_key = r.prop_key and user_id = r.user_id;
    begin
      continue when r.archived_at is not null or r.template_at is not null;
      continue when public.page_is_finished(r.page_id);
      select label into prop_label from public.property_defs
       where database_id = r.database_id and key = r.prop_key;
      select task_config into cfg from public.pages where id = r.database_id;
      for who in
        select distinct u
          from unnest(array[r.user_id] || coalesce(
                 case when cfg ? 'assignee' then public.person_ids(r.props -> (cfg ->> 'assignee')) end,
                 '{}'::uuid[])) u
      loop
        continue when not public.user_can_read_page(r.page_id, who);
        insert into public.notifications (workspace_id, user_id, actor_id, kind, page_id, excerpt)
        values (r.workspace_id, who, r.user_id, 'date_reminder', r.page_id,
                left(coalesce(prop_label, r.prop_key), 300));
        filed := filed + 1;
      end loop;
    exception when others then
      raise warning 'deliver_date_reminders skipped page %: %', r.page_id, sqlerrm;
    end;
  end loop;
  return filed;
end $$;

revoke all on function public.deliver_date_reminders() from public, anon, authenticated;

select cron.schedule('gio-date-reminders', '* * * * *', 'select public.deliver_date_reminders()');
