-- New pages are private by default, now in the database too.
--
-- Since 20261010015822 the app has created every page as 'restricted' and
-- the pages_grant_creator_access trigger makes the creator its editor; the
-- column default stayed 'workspace' until the new app was published, so an
-- older app couldn't create pages it then couldn't see. That app is
-- published now (Allan, 2026-10-10), so the default matches: a page created
-- without saying otherwise belongs to its creator alone. Existing pages
-- keep their access.

alter table public.pages alter column access_type set default 'restricted';
