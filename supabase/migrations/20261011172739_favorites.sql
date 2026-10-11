-- Favorites (Allan, 2026-10-11): each person stars pages they come back
-- to. They show in a Favorites section in the sidebar, on Home and on the
-- phone's Home tab, in the order they were starred. Kept on the person's
-- own home_prefs row (RLS: their own row only), like pinned views. A page
-- they can no longer open simply doesn't show; nothing is stored about it
-- beyond its id.

alter table public.home_prefs
  add column if not exists favorite_pages uuid[] not null default '{}';

alter table public.home_prefs
  add constraint home_prefs_favorites_max
  check (coalesce(array_length(favorite_pages, 1), 0) <= 200);
