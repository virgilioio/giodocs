-- Search everything (Allan, 2026-11-13): ⌘K finds a page by what's in it,
-- Notion's way, not only by its title.
--
-- Why it missed: pages were indexed with English word roots ("planning"
-- became "plan") while searches looked for the exact word, so "planning",
-- "interviews" or "hiring plan" found nothing in a page that said
-- "Planning the hiring interviews".
--
-- 1. A page's search vector now holds every word both ways, as its root
--    (English) and as written (simple): the title (weight A), every block
--    at any depth (B: toggles, callouts, columns, simple tables, sheets,
--    code, captions, file names, a view's name; mentions read as the name
--    they show, links as their words) and, for a database row, its text,
--    link, email, phone and option values (C, options by their labels).
-- 2. search_tsquery: every word typed must appear, each as the start of a
--    word or in another form of it ("intervi" finds "interviews",
--    "planning" finds "planned").
-- 3. search_workspace returns one row per page: title matches first, then
--    by how well the words match, then the newest edit; with up to two
--    matching blocks in document order (a block inside a closed toggle
--    answers with the toggle, which is what the page shows), or the
--    row's matching value. It runs as the caller, so people only find
--    pages they can open (RLS), archived pages and templates included.
-- 4. Every page's vector is rebuilt here. No triggers fire beyond the
--    row-number one, which keeps each row's number.

-- Words people read, from a block's stored text: mentions as the name
-- they show, links as their words and address, no markdown marks.
create or replace function public.search_clean(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(p_text, ''),
                 '@\[([^\]]*)\]\((user|page):[0-9A-Fa-f-]+\)', '\1', 'g'),
               '\[([^\]]*)\]\(([^)\s]*)\)', '\1 \2', 'g'),
             '[*_~`#>|]+', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

-- One block's own words (not its children's).
create or replace function public.block_search_text(b jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select public.search_clean(concat_ws(' ',
    b ->> 'text', b ->> 'body', b ->> 'cap', b ->> 'alt', b ->> 'fname',
    b -> 'view' ->> 'name',
    (select string_agg(cell, ' ')
       from jsonb_array_elements_text(
              coalesce(jsonb_path_query_array(b, 'lax $.rows[*][*] ? (@.type() == "string")'), '[]'::jsonb)) cell),
    (select string_agg(cv, ' ')
       from jsonb_array_elements_text(
              coalesce(jsonb_path_query_array(b, 'lax $.cells[*][*].v'), '[]'::jsonb)) cv)));
$$;

-- Every block of a page at any depth, in document order, with the block a
-- reader can see it in (a block inside a closed toggle shows as the
-- toggle).
create or replace function public.page_block_tree(p_blocks jsonb)
returns table (b jsonb, ord int[], anchor text)
language sql
immutable
set search_path = public
as $$
  with recursive tree(b, ord, anchor) as (
    select x.b, array[x.i::int], x.b ->> 'id'
      from jsonb_array_elements(case jsonb_typeof(p_blocks) when 'array' then p_blocks else '[]'::jsonb end)
           with ordinality as x(b, i)
    union all
    select k.nb, t.ord || k.path,
           case when t.b ->> 'type' = 'toggle' and coalesce((t.b ->> 'open')::boolean, false) is false
                then t.anchor else coalesce(k.nb ->> 'id', t.anchor) end
      from tree t,
           lateral (
             select c.nb, array[c.i::int] as path
               from jsonb_array_elements(case jsonb_typeof(t.b -> 'children') when 'array' then t.b -> 'children' else '[]'::jsonb end)
                    with ordinality as c(nb, i)
             union all
             select c.nb, array[col.j::int, c.i::int]
               from jsonb_array_elements(case jsonb_typeof(t.b -> 'cols') when 'array' then t.b -> 'cols' else '[]'::jsonb end)
                    with ordinality as col(cl, j),
                    lateral jsonb_array_elements(case jsonb_typeof(col.cl) when 'array' then col.cl else '[]'::jsonb end)
                    with ordinality as c(nb, i)
           ) k
     where array_length(t.ord, 1) < 40
  )
  select b, ord, anchor from tree;
$$;

-- A page's blocks as one text.
create or replace function public.page_search_body(p_blocks jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(string_agg(public.block_search_text(t.b), ' ' order by t.ord), '')
    from public.page_block_tree(p_blocks) t;
$$;

-- A row's searchable values, one per property: text, link, email, phone
-- and options (by their labels).
create or replace function public.page_props_search_parts(p_db uuid, p_props jsonb)
returns table (key text, label text, words text)
language sql
stable
set search_path = public
as $$
  select d.key, d.label,
         string_agg(case when d.type::text in ('select', 'status', 'multi_select')
                         then coalesce((select o ->> 'label'
                                          from jsonb_array_elements(case jsonb_typeof(d.options) when 'array' then d.options else '[]'::jsonb end) o
                                         where o ->> 'value' = x.v limit 1), x.v)
                         else x.v end, ', ')
    from public.property_defs d
    cross join lateral jsonb_array_elements_text(
           case jsonb_typeof(p_props -> d.key)
             when 'array' then p_props -> d.key
             when 'string' then jsonb_build_array(p_props -> d.key)
             else '[]'::jsonb
           end) as x(v)
   where p_db is not null
     and d.database_id = p_db
     and d.archived_at is null
     and d.type::text in ('text', 'url', 'email', 'phone', 'select', 'status', 'multi_select')
     and x.v <> ''
   group by d.key, d.label, d.position
   order by d.position;
$$;

create or replace function public.page_props_search_text(p_db uuid, p_props jsonb)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(string_agg(words, ' '), '') from public.page_props_search_parts(p_db, p_props);
$$;

-- Every word both as its root and as written, so a search can match
-- either.
create or replace function public.page_search_vector(p_title text, p_body text, p_props text)
returns tsvector
language sql
immutable
set search_path = public
as $$
  select setweight(to_tsvector('english', coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('simple', coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('english', coalesce(p_body, '')), 'B')
      || setweight(to_tsvector('simple', coalesce(p_body, '')), 'B')
      || setweight(to_tsvector('english', coalesce(p_props, '')), 'C')
      || setweight(to_tsvector('simple', coalesce(p_props, '')), 'C');
$$;

create or replace function public.pages_tsv_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_tsv := public.page_search_vector(
    new.title,
    public.page_search_body(new.blocks),
    case when new.database_id is not null
         then public.page_props_search_text(new.database_id, new.props) end);
  return new;
end $$;

-- pages_tsv runs when the title or blocks change; this one when only a
-- row's values (or its database) change.
create trigger pages_tsv_props
  before update of props, database_id on public.pages
  for each row
  when ((old.title, old.blocks) is not distinct from (new.title, new.blocks)
        and (old.props, old.database_id) is distinct from (new.props, new.database_id))
  execute function public.pages_tsv_trigger();

-- What was typed, as a search: every word must appear, each as the start
-- of a word as written or of its root. At most ten words.
create or replace function public.search_tsquery(p_q text)
returns tsquery
language plpgsql
immutable
set search_path = public
as $$
declare
  q tsquery;
  part tsquery;
  words text[];
  w text;
begin
  select array_agg(x) into words
    from regexp_split_to_table(lower(coalesce(p_q, '')), '[^[:alnum:]]+') x
   where x <> '';
  if words is null then
    return null;
  end if;
  -- A lone letter beside longer words ("laptop's") would match nearly
  -- everything: it counts only when it's all there is.
  if exists (select 1 from unnest(words) x where length(x) > 1) then
    words := array(select x from unnest(words) x where length(x) > 1);
  end if;
  foreach w in array words[1:10]
  loop
    w := left(w, 60);
    part := to_tsquery('simple', w || ':*') || to_tsquery('english', w || ':*');
    q := case when q is null then part else q && part end;
  end loop;
  return q;
end $$;

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
           replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') as pat
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
              from (select t.anchor, t.ord, public.block_search_text(t.b) as txt
                      from public.page_block_tree(h.blocks) t, q
                     where q.tq is not null
                       and (to_tsvector('english', public.block_search_text(t.b))
                            || to_tsvector('simple', public.block_search_text(t.b))) @@ q.tq
                     order by t.ord
                     limit 2) s),
           -- Else a row's value that matches.
           (select jsonb_agg(jsonb_build_object('id', null, 'text', s.label || ': ' || left(s.words, 300)))
              from (select pp.label, pp.words
                      from public.page_props_search_parts(h.database_id, h.props) pp, q
                     where q.tq is not null
                       and (to_tsvector('english', pp.words) || to_tsvector('simple', pp.words)) @@ q.tq
                     limit 1) s),
           '[]'::jsonb) as snippets,
         h.rank
    from hits h
   order by h.title_hit desc, h.title_rank desc, h.rank desc, h.edited_at desc;
$$;

revoke all on function public.search_clean(text) from public, anon;
revoke all on function public.block_search_text(jsonb) from public, anon;
revoke all on function public.page_block_tree(jsonb) from public, anon;
revoke all on function public.page_search_body(jsonb) from public, anon;
revoke all on function public.page_props_search_parts(uuid, jsonb) from public, anon;
revoke all on function public.page_props_search_text(uuid, jsonb) from public, anon;
revoke all on function public.page_search_vector(text, text, text) from public, anon;
revoke all on function public.search_tsquery(text) from public, anon;
revoke all on function public.search_workspace(uuid, text, int) from public, anon;
grant execute on function public.search_clean(text) to authenticated, service_role;
grant execute on function public.block_search_text(jsonb) to authenticated, service_role;
grant execute on function public.page_block_tree(jsonb) to authenticated, service_role;
grant execute on function public.page_search_body(jsonb) to authenticated, service_role;
grant execute on function public.page_props_search_parts(uuid, jsonb) to authenticated, service_role;
grant execute on function public.page_props_search_text(uuid, jsonb) to authenticated, service_role;
grant execute on function public.page_search_vector(text, text, text) to authenticated, service_role;
grant execute on function public.search_tsquery(text) to authenticated, service_role;
grant execute on function public.search_workspace(uuid, text, int) to authenticated, service_role;

-- Rebuild every page's vector (only search_tsv changes: no edit, version or
-- notification follows).
update public.pages
   set search_tsv = public.page_search_vector(
         title,
         public.page_search_body(blocks),
         case when database_id is not null then public.page_props_search_text(database_id, props) end);
