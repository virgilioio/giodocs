-- Pin search_path on the helper functions the security advisor flagged
-- (function_search_path_mutable). None of them reads a table by an
-- unqualified name today; pinning keeps it that way.

alter function public.block_mentions(jsonb) set search_path = public;
alter function public.mention_excerpt(text) set search_path = public;
alter function public.text_mentions(text) set search_path = public;
alter function public.page_search_text(text, jsonb) set search_path = public;
alter function public.safe_uuid(text) set search_path = public;
alter function public.guard_page_parent() set search_path = public;
