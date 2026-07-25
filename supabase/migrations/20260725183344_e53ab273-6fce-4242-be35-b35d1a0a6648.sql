create index pages_ws_edited_idx on public.pages (workspace_id, edited_at desc) where deleted_at is null;
create index pages_ws_verified_idx on public.pages (workspace_id, verified_at asc) where deleted_at is null;
create index pages_ws_title_idx on public.pages (workspace_id, lower(title)) where deleted_at is null;
create index pages_area_idx on public.pages (workspace_id, (props->>'area')) where deleted_at is null;
create index pages_owner_idx on public.pages (workspace_id, (props->>'owner')) where deleted_at is null;
create index pages_status_idx on public.pages (workspace_id, (props->>'status')) where deleted_at is null;
create index pages_props_gin on public.pages using gin (props jsonb_path_ops);
create index pages_search_idx on public.pages using gin (search_tsv);
create index views_ws_scope_idx on public.views (workspace_id, scope, position);
create index views_owner_idx on public.views (owner_id);
create index members_user_idx on public.workspace_members (user_id);
create index page_access_user_idx on public.page_access (user_id);

create or replace function public.page_search_text(p_title text, p_blocks jsonb)
returns text language sql immutable
set search_path = public
as $$
  select p_title || ' ' || coalesce((
    select string_agg(
      coalesce(b->>'text','') || ' ' || coalesce(b->>'body','') || ' ' ||
      coalesce((select string_agg(cell,' ') from jsonb_array_elements_text(
        coalesce(jsonb_path_query_array(b,'$.rows[*][*]'),'[]'::jsonb)) as cell),''),
      ' ')
    from jsonb_array_elements(p_blocks) b), '');
$$;

create or replace function public.pages_tsv_trigger() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_tsv := to_tsvector('english', public.page_search_text(new.title, new.blocks));
  return new;
end $$;

create trigger pages_tsv before insert or update of title, blocks
  on public.pages for each row execute function public.pages_tsv_trigger();

create or replace function public.validate_page_props() returns trigger
language plpgsql
set search_path = public
as $$
declare k text; d public.property_defs; v jsonb;
begin
  for k in select jsonb_object_keys(new.props) loop
    select * into d from public.property_defs
     where workspace_id = new.workspace_id and key = k;
    if d.id is null then
      raise exception 'Unknown property "%". Register it in property_defs first.', k
        using errcode='23514';
    end if;
    v := new.props -> k;
    if v = 'null'::jsonb then continue; end if;
    case d.type
      when 'multi_select' then
        if jsonb_typeof(v) <> 'array' then raise exception '% must be an array', k; end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then raise exception '% must be a boolean', k; end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' then raise exception '% must be a number', k; end if;
      when 'select','status' then
        if jsonb_array_length(d.options) > 0
           and not (d.options @> jsonb_build_array(jsonb_build_object('value', v #>> '{}')))
        then raise exception '% is not a legal value for %', v #>> '{}', k; end if;
      else null;
    end case;
  end loop;
  return new;
end $$;

create trigger pages_validate_props before insert or update of props
  on public.pages for each row execute function public.validate_page_props();

create or replace function public.touch_page() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.edited_at := now();
  new.edited_by := auth.uid();
  return new;
end $$;

create trigger pages_touch before update on public.pages
  for each row when ((old.title, old.blocks, old.props, old.icon)
               is distinct from (new.title, new.blocks, new.props, new.icon))
  execute function public.touch_page();