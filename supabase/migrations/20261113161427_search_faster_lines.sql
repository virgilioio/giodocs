-- Search everything, faster lines (Allan, 2026-11-13). Picking the line a
-- page matched in read every block's text three times and ran both word
-- parsers on all of them: a search took about half a second on the live
-- workspace. Now each block's text is read once, and only blocks holding
-- the first three letters of every typed word are parsed (any word that
-- matches starts with them, as written or as its root). The same lines
-- come back (compared on 274 page matches live), about 20 times faster.

-- The first three letters of each typed word, as LIKE patterns (words
-- read as search_tsquery reads them).
create or replace function public.search_prefix_patterns(p_q text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg('%' || left(x, 3) || '%'), '{}')
    from (select x from regexp_split_to_table(lower(coalesce(p_q, '')), '[^[:alnum:]]+') x where x <> '') w
   where length(x) > 1
      or not exists (select 1 from regexp_split_to_table(lower(coalesce(p_q, '')), '[^[:alnum:]]+') y
                      where length(y) > 1);
$$;

revoke all on function public.search_prefix_patterns(text) from public, anon;
grant execute on function public.search_prefix_patterns(text) to authenticated, service_role;

-- The search box (⌘K): pages whose title or content match, best first,
-- with where they match.
create or replace function public.search_workspace(p_workspace uuid, p_q text, p_limit int default 20)
returns table (
  id uuid, title text, icon text, parent_id uuid, database_id uuid, is_database boolean,
  archived boolean, template boolean, edited_at timestamptz,
  title_hit boolean, snippets jsonb, rank real)
language sql
stable
set search_path = public
as $$
  with q as (
    select public.search_tsquery(p_q) as tq,
           btrim(coalesce(p_q, '')) as raw,
           replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') as pat,
           public.search_prefix_patterns(p_q) as pats
  ),
  hits as (
    select p.id, p.title, p.icon, p.parent_id, p.database_id, p.is_database,
           p.archived_at is not null as archived, p.template_at is not null as template,
           p.edited_at, p.blocks, p.props,
           (p.title ilike '%' || q.pat || '%'
             or (q.tq is not null
                 and (to_tsvector('english', p.title) || to_tsvector('simple', p.title)) @@ q.tq)) as title_hit,
           (case when lower(p.title) = lower(q.raw) then 3
                 when p.title ilike q.pat || '%' then 2
                 when p.title ilike '%' || q.pat || '%' then 1
                 else 0 end) as title_rank,
           coalesce(case when q.tq is not null then ts_rank(p.search_tsv, q.tq) end, 0)::real as rank
      from public.pages p, q
     where p.workspace_id = p_workspace
       and p.deleted_at is null
       and q.raw <> ''
       and ((q.tq is not null and p.search_tsv @@ q.tq) or p.title ilike '%' || q.pat || '%')
     order by title_hit desc, title_rank desc, rank desc, p.edited_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  )
  select h.id, h.title, h.icon, h.parent_id, h.database_id, h.is_database,
         h.archived, h.template, h.edited_at, h.title_hit,
         coalesce(
           -- Up to two blocks that match, in document order.
           (select jsonb_agg(jsonb_build_object('id', s.anchor, 'text', left(s.txt, 600)) order by s.ord)
              from (select b.anchor, b.ord, b.txt
                      from (select t.anchor, t.ord, public.block_search_text(t.b) as txt
                              from public.page_block_tree(h.blocks) t
                            offset 0) b, q
                     where q.tq is not null
                       and lower(b.txt) like all (q.pats)
                       and (to_tsvector('english', b.txt) || to_tsvector('simple', b.txt)) @@ q.tq
                     order by b.ord
                     limit 2) s),
           -- Else a row's value that matches.
           (select jsonb_agg(jsonb_build_object('id', null, 'text', s.label || ': ' || left(s.words, 300)))
              from (select pp.label, pp.words
                      from public.page_props_search_parts(h.database_id, h.props) pp, q
                     where q.tq is not null
                       and lower(pp.words) like all (q.pats)
                       and (to_tsvector('english', pp.words) || to_tsvector('simple', pp.words)) @@ q.tq
                     limit 1) s),
           '[]'::jsonb) as snippets,
         h.rank
    from hits h
   order by h.title_hit desc, h.title_rank desc, h.rank desc, h.edited_at desc;
$$;
