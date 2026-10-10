-- @mentions: search reads a mention as the person's name, and a page lists
-- the pages that link to it ("Linked from").
--
-- A mention is stored in block text as "@[Name](user:<uuid>)" or
-- "@[](page:<uuid>)" (page mentions never store a title, so a private
-- page's title never sits in another page's text).

-- 1. Search text: "@[Sam Rivera](user:…)" indexes as "Sam Rivera"; a page
--    mention adds nothing. Same body as before, wrapped in two replaces.
--    Pages pick this up the next time they're edited.
create or replace function public.page_search_text(p_title text, p_blocks jsonb)
returns text
language sql
immutable
as $function$
  with recursive tree(b) as (
    select b from jsonb_array_elements(p_blocks) b
    union all
    select nb
      from tree t,
           lateral (
             select nb from jsonb_array_elements(coalesce(t.b->'children','[]'::jsonb)) nb
             union all
             select nb from jsonb_array_elements(coalesce(t.b->'cols','[]'::jsonb)) col,
                            lateral jsonb_array_elements(col) nb
           ) x
  )
  select regexp_replace(
           regexp_replace(
             p_title || ' ' || coalesce((
               select string_agg(
                 coalesce(b->>'text','')  || ' ' || coalesce(b->>'body','')  || ' ' ||
                 coalesce(b->>'cap','')   || ' ' || coalesce(b->>'alt','')   || ' ' ||
                 coalesce(b->>'fname','') || ' ' ||
                 coalesce((select string_agg(cell,' ')
                             from jsonb_array_elements_text(
                               coalesce(jsonb_path_query_array(b,'$.rows[*][*]'),'[]'::jsonb)
                             ) as cell), '') || ' ' ||
                 coalesce((select string_agg(cv,' ')
                             from jsonb_array_elements_text(
                               coalesce(jsonb_path_query_array(b,'$.cells[*][*].v'),'[]'::jsonb)
                             ) as cv), ''),
                 ' ')
               from tree), ''),
             '@\[([^]]*)\]\(user:[0-9a-f-]{36}\)', '\1', 'g'),
           '@\[[^]]*\]\(page:[0-9a-f-]{36}\)', '', 'g');
$function$;

revoke all on function public.page_search_text(text, jsonb) from public, anon;
grant execute on function public.page_search_text(text, jsonb) to authenticated;
grant execute on function public.page_search_text(text, jsonb) to service_role;

-- 2. "Linked from": the pages that mention, link to, embed or relate to a
--    page. Runs as the caller, so it only ever returns pages they can
--    read. A page is referenced by its full id (mentions, page blocks,
--    related pages, full links) or by a /p/<slug>-<first 6 of its id> link.
create or replace function public.page_backlinks(p_page uuid)
returns table (id uuid, title text, icon text, edited_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $function$
  with target as (
    select p.id, p.workspace_id,
           p.id::text as full_id,
           left(replace(p.id::text, '-', ''), 6) as short_id
      from public.pages p
     where p.id = p_page
  )
  select s.id, s.title, s.icon, s.edited_at
    from public.pages s, target t
   where s.workspace_id = t.workspace_id
     and s.deleted_at is null
     and s.id <> t.id
     and (strpos(s.blocks::text, t.full_id) > 0
       or strpos(s.props::text, t.full_id) > 0
       or s.blocks::text ~ ('/p/[a-z0-9-]*-' || t.short_id || '([^0-9a-z]|$)'))
   order by s.edited_at desc
   limit 50;
$function$;

revoke all on function public.page_backlinks(uuid) from public, anon;
grant execute on function public.page_backlinks(uuid) to authenticated;
grant execute on function public.page_backlinks(uuid) to service_role;
