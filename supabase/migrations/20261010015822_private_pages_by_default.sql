-- New pages are private to the person who creates them.
--
-- Decided by Allan, 2026-10-09: a new page starts with sole access for its
-- creator; sharing with more people or with everyone in the workspace is a
-- separate, explicit decision (the share panel). Existing pages keep the
-- access they have today.
--
-- Model (unchanged): access_type 'workspace' = everyone in the workspace;
-- 'restricted' = only the people listed in page_access. "Private" is simply
-- 'restricted' with the creator as the only entry.

-- 1. The app creates new pages as 'restricted'. The column default stays
--    'workspace' for now: the published app (until it's republished from
--    Lovable) still creates pages with insert...returning, which RLS would
--    reject for a restricted page whose creator row is added after the
--    insert. Flip the default in a later migration once the new app is live.

-- 2. Whoever creates a restricted page can edit it. SECURITY DEFINER because
--    page_access's insert policy (can_manage_page_access) can't pass for a
--    restricted page that has no writer yet. Runs AFTER INSERT so the page
--    row exists for the foreign key.
create or replace function public.grant_creator_page_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.access_type = 'restricted' and new.created_by is not null then
    insert into page_access (page_id, user_id, capability)
    values (new.id, new.created_by, 'write')
    on conflict (page_id, user_id) where user_id is not null
    do update set capability = 'write';
  end if;
  return null;
end $$;

revoke all on function public.grant_creator_page_access() from public, anon, authenticated;

create trigger pages_grant_creator_access
  after insert on public.pages
  for each row execute function public.grant_creator_page_access();

-- Sharing afterwards goes through set_page_access(), which already keeps the
-- page's owner (or the person sharing) on a restricted page and never leaves
-- it with no one at the workspace.
