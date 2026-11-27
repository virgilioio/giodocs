-- Rolled-back test for 20261127190000_invite_links (run after it in one
-- transaction). The last statement raises with the results, so nothing is kept.
-- Uses a made-up address at example.com and the workspace's first owner.

do $t$
declare
  actor text;
  who text := 'invite-links-test@example.com';
  a jsonb; c jsonb;
  t1 uuid; t2 uuid; ok boolean;
  r text := '';
begin
  select lower(p.email) into actor from public.profiles p
  join public.workspace_members m on m.user_id = p.id and m.role = 'owner'
  order by m.created_at limit 1;

  -- 1. A grant invites; sending again keeps the same link and adds 7 days.
  a := public.os_apply_grant(gen_random_uuid(), who, 'member', actor);
  t1 := (a->>'token')::uuid;
  r := r || 'grant=' || (a->>'outcome');                                                    -- invited
  a := public.os_resend_invite(gen_random_uuid(), who, 'member', actor);
  r := r || ' resend=' || (a->>'outcome') || ' same_link=' || ((a->>'token')::uuid = t1)::text;   -- invited, true

  -- 2. People & Access reads it and gets the same link to hand over.
  c := public.os_invite_action(who, actor, 'status');
  r := r || ' status=' || (c->>'state') || ' no_token_on_status=' || (c->>'token' is null)::text;  -- pending, true
  c := public.os_invite_action(who, actor, 'link');
  r := r || ' link_same=' || ((c->>'token')::uuid = t1)::text;                               -- true
  c := public.os_invite_action(who, 'nobody@example.com', 'status');
  r := r || ' stranger=' || (c->>'outcome');                                                 -- refused

  -- 3. Time passes and it expires (set directly, as the clock would).
  set local session_replication_role = replica;
  update public.workspace_invites set expires_at = now() - interval '1 day' where token = t1;
  set local session_replication_role = origin;
  c := public.os_invite_action(who, actor, 'status');
  r := r || ' expired=' || (c->>'state');                                                    -- expired
  r := r || ' preview_expired=' || (select state from public.invite_preview(t1));            -- expired

  -- 4. The person asks for a new link: a new one opens, the expired one doesn't.
  c := public.invite_renew_request(t1);
  t2 := (c->>'token')::uuid;
  r := r || ' renew=' || (c->>'state') || ' new_link=' || (t2 <> t1)::text;                  -- renewed, true
  r := r || ' old=' || coalesce((select state from public.invite_preview(t1)), 'not_found')  -- not_found
         || ' new=' || (select state from public.invite_preview(t2));                         -- valid
  c := public.invite_renew_request(t2);
  r := r || ' renew_valid=' || (c->>'state');                                                -- valid
  c := public.invite_renew_request(gen_random_uuid());
  r := r || ' renew_unknown=' || (c->>'state');                                              -- not_found

  -- 5. Removing access withdraws it: withdrawn on the page, not renewable.
  a := public.os_apply_grant(gen_random_uuid(), who, null, actor);
  r := r || ' removed=' || (a->>'outcome')                                                   -- invite_revoked
         || ' page=' || (select state from public.invite_preview(t2))                         -- revoked
         || ' renew_withdrawn=' || (public.invite_renew_request(t2)->>'state')                -- revoked
         || ' status_withdrawn=' || (public.os_invite_action(who, actor, 'status')->>'state'); -- withdrawn

  -- 6. Giving access again brings the same link back.
  a := public.os_apply_grant(gen_random_uuid(), who, 'member', actor);
  r := r || ' regrant=' || (a->>'outcome') || ' same=' || ((a->>'token')::uuid = t2)::text   -- invited, true
         || ' page_again=' || (select state from public.invite_preview(t2));                  -- valid

  -- 7. The browser can't call the new functions.
  r := r || ' auth_action=' || has_function_privilege('authenticated', 'public.os_invite_action(text,text,text)', 'execute')::text
         || ' anon_renew=' || has_function_privilege('anon', 'public.invite_renew_request(uuid)', 'execute')::text;  -- false, false

  raise exception 'RESULT %', r;
end $t$;
