-- Each view keeps its own table settings.
--
-- views.config holds how a view shows its pages, separate from what it
-- shows (filter) and in what order (sort):
--   props   the properties shown in a table, in order ("@…" names are the
--           built-in ones: created, edited, verified, created by, edited by)
--   widths  property → width in px, once someone resizes it
--   calcs   property → the calculation shown under it (count, sum, …)
--   group   the property a table is grouped by (boards keep group_by)
-- Like filter and sort, it's plain data the app reads; the app keeps
-- working with an empty object (the default layout). Copies of a view
-- carry it over. Kept small: no view needs more than a few KB of settings.

alter table public.views
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.views
  add constraint views_config_shape
  check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 32768);
