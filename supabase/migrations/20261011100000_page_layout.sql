-- How a database's rows show their properties when opened as pages
-- (Notion's "Page view for <database>", Allan 2026-10-11).
--
-- pages.page_layout, on the DATABASE page, applies to every row:
--   { "order": ["key", ...],                 -- the strip's order
--     "show":  { "key": "always" | "filled" | "never" } }
-- "always" shows the property even when empty, "filled" only when it has a
-- value ("Hide when empty"), "never" keeps it in the "N more properties"
-- fold. Unset keeps today's rule (the first three always, the rest when
-- filled). The app reads it defensively (src/lib/page-layout.ts).
--
-- Who may change it: anyone who can edit the database page. The pages
-- UPDATE policy lets any member update a workspace page and
-- pages_guard_edit only checks content columns, so database settings
-- (page_layout, and task_config from the Home migration) get their own
-- guard here: a view-only member can't change them.

alter table public.pages
  add column if not exists page_layout jsonb;

create or replace function public.guard_database_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l jsonb := new.page_layout;
  v text;
begin
  if new.page_layout is not distinct from old.page_layout
     and new.task_config is not distinct from old.task_config then
    return new;
  end if;
  if auth.uid() is not null and not public.can_edit_page_row(old) then
    raise exception 'You can view this database but not change its settings.' using errcode = '42501';
  end if;
  if l is null or l is not distinct from old.page_layout then
    return new;
  end if;
  if not new.is_database then
    raise exception 'Only a database has a page layout.' using errcode = '23514';
  end if;
  if jsonb_typeof(l) <> 'object'
     or exists (select 1 from jsonb_object_keys(l) k where k not in ('order', 'show'))
     or (l ? 'order' and jsonb_typeof(l -> 'order') <> 'array')
     or (l ? 'show' and jsonb_typeof(l -> 'show') <> 'object') then
    raise exception 'A page layout has an order list and a show map.' using errcode = '23514';
  end if;
  if l ? 'order' and (
       jsonb_array_length(l -> 'order') > 300
       or exists (select 1 from jsonb_array_elements(l -> 'order') e
                   where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 31)) then
    raise exception 'The page layout''s order names properties by key.' using errcode = '23514';
  end if;
  if l ? 'show' then
    if (select count(*) from jsonb_object_keys(l -> 'show')) > 300 then
      raise exception 'The page layout names too many properties.' using errcode = '23514';
    end if;
    for v in select value #>> '{}' from jsonb_each(l -> 'show') loop
      if v is null or v not in ('always', 'filled', 'never') then
        raise exception 'A property shows always, when filled, or never.' using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end $$;

revoke all on function public.guard_database_settings() from public, anon;
grant execute on function public.guard_database_settings() to authenticated, service_role;

create trigger pages_guard_database_settings
  before update of page_layout, task_config on public.pages
  for each row execute function public.guard_database_settings();
