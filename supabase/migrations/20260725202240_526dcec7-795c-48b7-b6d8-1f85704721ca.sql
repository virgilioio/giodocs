-- 1. Repair any existing rows with NULL token columns.
UPDATE auth.users SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change               = COALESCE(email_change, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '');

-- 2. Seed Allan as the first real owner. Token columns start as ''.
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current, phone_change, phone_change_token, reauthentication_token)
VALUES
  ('00000000-0000-0000-0000-000000000000',
   'a11a0000-0000-4000-8000-000000000001',
   'authenticated','authenticated',
   'allan@virgilio.tech',
   crypt('GioSeed!2026', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Allan"}',
   '','','','','','','','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities
  (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
VALUES
  (gen_random_uuid(),
   'a11a0000-0000-4000-8000-000000000001',
   '{"sub":"a11a0000-0000-4000-8000-000000000001","email":"allan@virgilio.tech","email_verified":true}'::jsonb,
   'email',
   'allan@virgilio.tech',
   now(), now(), now())
ON CONFLICT DO NOTHING;

-- 3. Promote Allan to owner (handle_new_user already inserted him as member).
UPDATE public.workspace_members
   SET role = 'owner'
 WHERE user_id = 'a11a0000-0000-4000-8000-000000000001';

-- 4. Assign five pages to Allan; make the alphabetically-first one stale.
WITH picks AS (
  SELECT id, row_number() OVER (ORDER BY props->>'area', title) AS rn
    FROM public.pages
   WHERE props ? 'owner' AND deleted_at IS NULL
)
UPDATE public.pages p
   SET props = p.props || jsonb_build_object('owner','a11a0000-0000-4000-8000-000000000001')
  FROM picks
 WHERE p.id = picks.id AND picks.rn IN (1,4,7,10,13);

UPDATE public.pages
   SET verified_at = now() - interval '210 days'
 WHERE id = (
   SELECT id FROM public.pages
    WHERE props->>'owner' = 'a11a0000-0000-4000-8000-000000000001'
    ORDER BY title
    LIMIT 1
 );