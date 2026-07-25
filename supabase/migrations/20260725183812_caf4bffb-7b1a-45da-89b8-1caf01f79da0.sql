create extension if not exists pgcrypto;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  tints text[] := array['#DCFBE9','#FCE7C8','#DCEAFE','#EDE4FF','#FBE0EE','#FAF4C4'];
  inks  text[] := array['#0B7A57','#B45309','#2563EB','#5B21B6','#BE185D','#7A6A10'];
  i int;
begin
  i := (abs(hashtext(new.id::text)) % 6) + 1;

  insert into public.profiles (id, full_name, email, avatar_tint, avatar_ink)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email,
          tints[i], inks[i])
  on conflict (id) do nothing;

  select d.workspace_id into ws from public.allowed_domains d
   where d.domain = lower(split_part(new.email,'@',2)) limit 1;

  if ws is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws, new.id, 'member') on conflict do nothing;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.domain_status(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select case when exists (
    select 1 from public.allowed_domains
     where domain = lower(split_part(p_email,'@',2))
  ) then 'member' else 'invite_only' end;
$$;

revoke all on function public.domain_status(text) from public;
grant execute on function public.domain_status(text) to anon, authenticated;