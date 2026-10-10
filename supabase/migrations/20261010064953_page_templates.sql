-- Templates: a page anyone can start new pages from.
--
-- A template is still just a page, in a state, like an archived one:
-- template_at says when it became a template (null = an ordinary page). It
-- leaves views and the page lists (the app reads only template_at is null
-- there), stays in search, and is offered when someone starts a new page.
-- Whoever can edit a page can make it a template or stop using it as one
-- (the existing pages_update rule). Like archiving, it doesn't count as an
-- edit: touch_page only reacts to title, blocks, props and icon.

alter table public.pages add column if not exists template_at timestamptz;

create index if not exists pages_templates
  on public.pages (workspace_id)
  where template_at is not null and deleted_at is null;
