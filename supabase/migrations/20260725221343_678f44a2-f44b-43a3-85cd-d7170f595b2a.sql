-- 1a: lock down stamp columns
revoke update (verified_at, verified_by, edited_at, edited_by)
  on public.pages from authenticated;
revoke update (verified_at, verified_by, edited_at, edited_by)
  on public.pages from anon;

-- verify_page becomes SECURITY DEFINER with its own auth check
create or replace function public.verify_page(p_page uuid)
returns public.pages
language plpgsql
security definer
set search_path = public
as $$
declare r public.pages;
begin
  if not public.can_read_page(p_page) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.page_verifications(page_id, verified_by)
    values (p_page, auth.uid());
  update public.pages
     set verified_at = now(), verified_by = auth.uid()
   where id = p_page
   returning * into r;
  return r;
end $$;

revoke execute on function public.verify_page(uuid) from public;
revoke execute on function public.verify_page(uuid) from anon;
grant  execute on function public.verify_page(uuid) to authenticated;

-- 1b: strip anon table privileges; RLS is no longer the sole gate
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- pages have no DELETE policy by design (soft-delete only)
revoke delete on public.pages from authenticated;