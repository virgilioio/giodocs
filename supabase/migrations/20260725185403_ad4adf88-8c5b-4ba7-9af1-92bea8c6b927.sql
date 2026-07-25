-- 1. Workspace
INSERT INTO public.workspaces (id, name, icon, slug, stale_days)
VALUES ('11111111-1111-1111-1111-111111111111', 'Virgilio LLC', '🧭', 'virgilio', 90);

-- 2. Allowed domain (must exist before users so the signup trigger adds memberships)
INSERT INTO public.allowed_domains (workspace_id, domain)
VALUES ('11111111-1111-1111-1111-111111111111', 'virgilio.tech');

-- 3. Property defs
INSERT INTO public.property_defs (workspace_id, key, label, type, options, position, is_system) VALUES
('11111111-1111-1111-1111-111111111111','area','Area','select',
 '[{"value":"Engineering","label":"Engineering","dot":"whisper","tint":"sunken","ink":"secondary"},
   {"value":"Product","label":"Product","dot":"whisper","tint":"sunken","ink":"secondary"},
   {"value":"Design","label":"Design","dot":"whisper","tint":"sunken","ink":"secondary"},
   {"value":"Hiring","label":"Hiring","dot":"whisper","tint":"sunken","ink":"secondary"},
   {"value":"Ops","label":"Ops","dot":"whisper","tint":"sunken","ink":"secondary"}]'::jsonb, 1, true),
('11111111-1111-1111-1111-111111111111','owner','Owner','person','[]'::jsonb, 2, true),
('11111111-1111-1111-1111-111111111111','status','Status','status',
 '[{"value":"Draft","label":"Draft","dot":"whisper","tint":"sunken","ink":"secondary"},
   {"value":"In review","label":"In review","dot":"amberDot","tint":"amberTint","ink":"amberInk"},
   {"value":"Live","label":"Live","dot":"accentDot","tint":"accentTint","ink":"accent"},
   {"value":"Archived","label":"Archived","dot":"whisper","tint":"sunken","ink":"secondary"}]'::jsonb, 3, true),
('11111111-1111-1111-1111-111111111111','tags','Tags','multi_select','[]'::jsonb, 4, true),
('11111111-1111-1111-1111-111111111111','stage','Stage','select',
 '[{"value":"Screen","label":"Screen","dot":"blue","tint":"blueTint","ink":"blueInk"},
   {"value":"Interview","label":"Interview","dot":"amberDot","tint":"amberTint","ink":"amberInk"},
   {"value":"Offer","label":"Offer","dot":"pink","tint":"pinkTint","ink":"pinkInk"},
   {"value":"Hired","label":"Hired","dot":"accentDot","tint":"accentTint","ink":"accent"}]'::jsonb, 5, false),
('11111111-1111-1111-1111-111111111111','priority','Priority','select',
 '[{"value":"P0","label":"P0","dot":"dangerDot","tint":"dangerTint","ink":"danger"},
   {"value":"P1","label":"P1","dot":"amberDot","tint":"amberTint","ink":"amberInk"},
   {"value":"P2","label":"P2","dot":"blue","tint":"blueTint","ink":"blueInk"}]'::jsonb, 6, false),
('11111111-1111-1111-1111-111111111111','due','Due','date','[]'::jsonb, 7, false),
('11111111-1111-1111-1111-111111111111','effort','Effort','number','[]'::jsonb, 8, false),
('11111111-1111-1111-1111-111111111111','reviewer','Reviewer','person','[]'::jsonb, 9, false),
('11111111-1111-1111-1111-111111111111','confidential','Confidential','checkbox','[]'::jsonb, 10, false),
('11111111-1111-1111-1111-111111111111','notes','Notes','text','[]'::jsonb, 11, false);

-- 4. Users (auth.users + auth.identities). Trigger creates profiles + memberships.
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','ava@virgilio.tech',   crypt('GioSeed!2026', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Ava Chen"}'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','marco@virgilio.tech', crypt('GioSeed!2026', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Marco Rossi"}'),
  ('00000000-0000-0000-0000-000000000000','cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','nina@virgilio.tech',  crypt('GioSeed!2026', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Nina Patel"}'),
  ('00000000-0000-0000-0000-000000000000','dddddddd-dddd-dddd-dddd-dddddddddddd','authenticated','authenticated','diego@virgilio.tech', crypt('GioSeed!2026', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Diego Alvarez"}'),
  ('00000000-0000-0000-0000-000000000000','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','authenticated','authenticated','lena@virgilio.tech',  crypt('GioSeed!2026', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Lena Kim"}'),
  ('00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff','authenticated','authenticated','sam@virgilio.tech',   crypt('GioSeed!2026', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Sam Okafor"}');

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at) VALUES
  (gen_random_uuid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","email":"ava@virgilio.tech"}','email','ava@virgilio.tech',now(),now(),now()),
  (gen_random_uuid(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","email":"marco@virgilio.tech"}','email','marco@virgilio.tech',now(),now(),now()),
  (gen_random_uuid(),'cccccccc-cccc-cccc-cccc-cccccccccccc','{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","email":"nina@virgilio.tech"}','email','nina@virgilio.tech',now(),now(),now()),
  (gen_random_uuid(),'dddddddd-dddd-dddd-dddd-dddddddddddd','{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","email":"diego@virgilio.tech"}','email','diego@virgilio.tech',now(),now(),now()),
  (gen_random_uuid(),'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","email":"lena@virgilio.tech"}','email','lena@virgilio.tech',now(),now(),now()),
  (gen_random_uuid(),'ffffffff-ffff-ffff-ffff-ffffffffffff','{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","email":"sam@virgilio.tech"}','email','sam@virgilio.tech',now(),now(),now());

-- 5. Promote Ava and Marco to owner
UPDATE public.workspace_members SET role='owner'
 WHERE workspace_id='11111111-1111-1111-1111-111111111111'
   AND user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- 6. Pages (22)
INSERT INTO public.pages (id, workspace_id, title, icon, props, blocks, created_by) VALUES

-- Engineering
('22222222-2222-2222-2222-000000000001','11111111-1111-1111-1111-111111111111','Deploy runbook','🚀',
 '{"area":"Engineering","owner":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"Live","tags":["runbook","prod"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Deploy runbook"},
   {"id":"b2","type":"text","text":"Deployments run from the main branch after CI is green. Merges are fast-forward only; the release train runs at 10:00 and 16:00 CET on weekdays."},
   {"id":"b3","type":"h2","text":"Pre-flight"},
   {"id":"b4","type":"bullet","text":"Confirm the staging smoke report from the last two hours is clean."},
   {"id":"b5","type":"bullet","text":"Check that no open incidents exist in the on-call channel."},
   {"id":"b6","type":"h2","text":"Rollback"},
   {"id":"b7","type":"text","text":"If p95 latency doubles or error rate exceeds one percent within ten minutes of rollout, revert to the previous image tag and post in eng-incidents."}]'::jsonb,
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),

('22222222-2222-2222-2222-000000000002','11111111-1111-1111-1111-111111111111','On-call rotation','📟',
 '{"area":"Engineering","owner":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","status":"Live","tags":["oncall","ops"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"On-call rotation"},
   {"id":"b2","type":"text","text":"Rotation follows a weekly primary and secondary schedule across two time zones. Handoff happens Monday at 10:00 CET via a written summary."},
   {"id":"b3","type":"h2","text":"Response targets"},
   {"id":"b4","type":"bullet","text":"P0: acknowledge in five minutes, engage within fifteen."},
   {"id":"b5","type":"bullet","text":"P1: acknowledge in fifteen minutes, mitigate the same day."},
   {"id":"b6","type":"h2","text":"Escalation"},
   {"id":"b7","type":"text","text":"After thirty minutes without mitigation, page the secondary; after sixty, page engineering leadership."}]'::jsonb,
 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),

('22222222-2222-2222-2222-000000000003','11111111-1111-1111-1111-111111111111','Postgres backup policy','🗄️',
 '{"area":"Engineering","owner":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"Live","tags":["db"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Postgres backup policy"},
   {"id":"b2","type":"text","text":"We keep continuous WAL archiving with a fourteen-day PITR window and daily base backups retained for thirty-five days."},
   {"id":"b3","type":"bullet","text":"Weekly restore drills against a scratch project verify that base backups plus WAL replay complete under an hour."},
   {"id":"b4","type":"bullet","text":"Backups are encrypted at rest with a customer-managed key rotated every ninety days."},
   {"id":"b5","type":"quote","text":"If it is not tested, it is not a backup."}]'::jsonb,
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),

('22222222-2222-2222-2222-000000000004','11111111-1111-1111-1111-111111111111','API rate-limit design','⚙️',
 '{"area":"Engineering","owner":"cccccccc-cccc-cccc-cccc-cccccccccccc","status":"In review","priority":"P1","tags":["api","design"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"API rate-limit design"},
   {"id":"b2","type":"text","text":"We are moving from per-IP to per-workspace token buckets so noisy neighbours cannot starve the shared quota."},
   {"id":"b3","type":"h2","text":"Buckets"},
   {"id":"b4","type":"bullet","text":"Read: 600 requests per minute per workspace, burst 120."},
   {"id":"b5","type":"bullet","text":"Write: 120 per minute, burst 30, with per-endpoint overrides."},
   {"id":"b6","type":"callout","text":"Return X-RateLimit-Remaining and Retry-After on every 429 so clients can back off deterministically."}]'::jsonb,
 'cccccccc-cccc-cccc-cccc-cccccccccccc'),

('22222222-2222-2222-2222-000000000005','11111111-1111-1111-1111-111111111111','Incident retro — Q2 checkout outage','🧯',
 '{"area":"Engineering","owner":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","status":"Live","tags":["retro","meeting"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Incident retro — Q2 checkout outage"},
   {"id":"b2","type":"h2","text":"Timeline"},
   {"id":"b3","type":"text","text":"On June 14 at 09:42 CET a connection-pool exhaustion in the billing service caused checkout to fail for 38 minutes across EU regions."},
   {"id":"b4","type":"h2","text":"Root cause"},
   {"id":"b5","type":"text","text":"A migration held an advisory lock while running an unindexed backfill. Requests queued, pool filled, dependent services timed out."},
   {"id":"b6","type":"h2","text":"Action items"},
   {"id":"b7","type":"todo","text":"Add a pre-migration linter that blocks statements holding locks over one second."},
   {"id":"b8","type":"todo","text":"Move long backfills to a shadow job queue with concurrency caps."}]'::jsonb,
 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),

-- Product
('22222222-2222-2222-2222-000000000006','11111111-1111-1111-1111-111111111111','Launch plan — Billing v2','🚦',
 '{"area":"Product","owner":"dddddddd-dddd-dddd-dddd-dddddddddddd","status":"In review","priority":"P0","tags":["launch","q3-goal"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Launch plan — Billing v2"},
   {"id":"b2","type":"text","text":"Billing v2 introduces seat-based pricing with usage add-ons. Launch is staged: internal on August 12, private beta August 26, general availability September 15."},
   {"id":"b3","type":"h2","text":"Success criteria"},
   {"id":"b4","type":"bullet","text":"Net revenue retention above 110 percent within one quarter of GA."},
   {"id":"b5","type":"bullet","text":"Support tickets tagged billing decrease week over week after week two."},
   {"id":"b6","type":"h2","text":"Comms"},
   {"id":"b7","type":"text","text":"Existing customers receive a fourteen-day advance notice with a migration calculator; new sign-ups land on v2 the day GA ships."}]'::jsonb,
 'dddddddd-dddd-dddd-dddd-dddddddddddd'),

('22222222-2222-2222-2222-000000000007','11111111-1111-1111-1111-111111111111','PRD — Billing v2','📝',
 '{"area":"Product","owner":"dddddddd-dddd-dddd-dddd-dddddddddddd","status":"Draft","tags":["prd"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"PRD — Billing v2"},
   {"id":"b2","type":"h2","text":"Problem"},
   {"id":"b3","type":"text","text":"Flat-rate pricing under-charges heavy accounts and over-charges long-tail teams. Sales spends cycles quoting exceptions instead of closing."},
   {"id":"b4","type":"h2","text":"Proposal"},
   {"id":"b5","type":"text","text":"Introduce three seat tiers with two usage add-ons — API calls and storage — priced to keep the median existing account within five percent of today."},
   {"id":"b6","type":"h2","text":"Out of scope"},
   {"id":"b7","type":"bullet","text":"Marketplace revenue share (tracked separately in the partners PRD)."}]'::jsonb,
 'dddddddd-dddd-dddd-dddd-dddddddddddd'),

('22222222-2222-2222-2222-000000000008','11111111-1111-1111-1111-111111111111','Q3 goals','🎯',
 '{"area":"Product","owner":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"Live","tags":["q3-goal","planning"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Q3 goals"},
   {"id":"b2","type":"bullet","text":"Ship Billing v2 to general availability by September 15."},
   {"id":"b3","type":"bullet","text":"Cut activation time from twelve to five minutes for new workspaces."},
   {"id":"b4","type":"bullet","text":"Hire two senior engineers and one product designer."},
   {"id":"b5","type":"bullet","text":"Bring p95 API latency below 250ms in the EU region."},
   {"id":"b6","type":"callout","text":"Every goal has a named directly responsible individual and a weekly check-in."}]'::jsonb,
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),

('22222222-2222-2222-2222-000000000009','11111111-1111-1111-1111-111111111111','Pricing revamp','💸',
 '{"area":"Product","owner":"dddddddd-dddd-dddd-dddd-dddddddddddd","status":"Draft","priority":"P0","tags":["pricing","q3-goal"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Pricing revamp"},
   {"id":"b2","type":"text","text":"Working thesis: our current three-plan ladder loses on the low end to self-serve competitors and on the high end to platforms that quote per-seat."},
   {"id":"b3","type":"bullet","text":"Add a free tier capped by workspace size, not by feature."},
   {"id":"b4","type":"bullet","text":"Rename Business to Team; Enterprise stays but becomes negotiated only."},
   {"id":"b5","type":"quote","text":"Pricing is a product surface — every change ships with docs, in-app copy, and a sales script."}]'::jsonb,
 'dddddddd-dddd-dddd-dddd-dddddddddddd'),

-- Design
('22222222-2222-2222-2222-000000000010','11111111-1111-1111-1111-111111111111','Design system note — tokens','🎨',
 '{"area":"Design","owner":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","status":"Live","tags":["design-system"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Design system note — tokens"},
   {"id":"b2","type":"text","text":"Every colour, radius, and font-size in the product resolves through a semantic token. If a component needs a value that no token expresses, we add a token, we do not hard-code."},
   {"id":"b3","type":"bullet","text":"Text sizes live in the @theme block and are referenced through Tailwind utilities only."},
   {"id":"b4","type":"bullet","text":"Colour intent (body, secondary, accent) is separate from surface intent (canvas, sunken, elevated)."},
   {"id":"b5","type":"callout","text":"When in doubt, name for role, not for looks. warningInk survives a palette change; orange600 does not."}]'::jsonb,
 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),

('22222222-2222-2222-2222-000000000011','11111111-1111-1111-1111-111111111111','Icon set audit','🧩',
 '{"area":"Design","owner":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","status":"In review","tags":["icons"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Icon set audit"},
   {"id":"b2","type":"text","text":"We currently ship 214 icons across three sizes. Roughly a quarter are one-off variants introduced for a single screen and never reused."},
   {"id":"b3","type":"bullet","text":"Consolidate duplicates by intent (arrow-right vs chevron-right vs caret-right)."},
   {"id":"b4","type":"bullet","text":"Retire any icon used in fewer than three surfaces unless it is a brand mark."},
   {"id":"b5","type":"todo","text":"Publish the pruned set as v3 and mark v2 deprecated in the design library."}]'::jsonb,
 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),

('22222222-2222-2222-2222-000000000012','11111111-1111-1111-1111-111111111111','Brand refresh brief','🖌️',
 '{"area":"Design","owner":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","status":"Draft","priority":"P2","tags":["brand"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Brand refresh brief"},
   {"id":"b2","type":"text","text":"The current wordmark reads as a 2019 productivity tool. We want a mark that survives at 16px in a browser tab and at 200px on a conference booth."},
   {"id":"b3","type":"h2","text":"Constraints"},
   {"id":"b4","type":"bullet","text":"One weight for the wordmark, one accent glyph, no gradient."},
   {"id":"b5","type":"bullet","text":"Print-safe in single colour; distinguishable in monochrome."}]'::jsonb,
 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),

-- Hiring
('22222222-2222-2222-2222-000000000013','11111111-1111-1111-1111-111111111111','Interview loop','🎤',
 '{"area":"Hiring","owner":"ffffffff-ffff-ffff-ffff-ffffffffffff","status":"Live","tags":["process"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Interview loop"},
   {"id":"b2","type":"text","text":"Every candidate goes through the same five-stage loop regardless of seniority. Stages are calibrated so a signal from one interviewer means the same thing as a signal from another."},
   {"id":"b3","type":"h2","text":"Stages"},
   {"id":"b4","type":"numbered","text":"Recruiter screen — thirty minutes, motivation and logistics."},
   {"id":"b5","type":"numbered","text":"Hiring-manager conversation — sixty minutes, scope and impact."},
   {"id":"b6","type":"numbered","text":"Technical deep-dive — ninety minutes, real system in the codebase."},
   {"id":"b7","type":"numbered","text":"Cross-functional partner — forty-five minutes, collaboration signal."},
   {"id":"b8","type":"numbered","text":"Values conversation with a founder — thirty minutes."}]'::jsonb,
 'ffffffff-ffff-ffff-ffff-ffffffffffff'),

('22222222-2222-2222-2222-000000000014','11111111-1111-1111-1111-111111111111','Compensation bands','💰',
 '{"area":"Hiring","owner":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"Live","tags":["comp"],"confidential":true}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Compensation bands"},
   {"id":"b2","type":"text","text":"Bands are anchored to the 60th percentile of the market for Berlin and Lisbon, adjusted by role family. Bands are reviewed once a year in January."},
   {"id":"b3","type":"h2","text":"Engineering"},
   {"id":"b4","type":"bullet","text":"L3 (mid): €70k–€85k base, 0.05%–0.10% equity."},
   {"id":"b5","type":"bullet","text":"L4 (senior): €90k–€115k base, 0.10%–0.20% equity."},
   {"id":"b6","type":"bullet","text":"L5 (staff): €120k–€145k base, 0.20%–0.35% equity."},
   {"id":"b7","type":"callout","text":"Bands are shared with every offer letter. If we cannot explain the band, we cannot defend the offer."}]'::jsonb,
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),

('22222222-2222-2222-2222-000000000015','11111111-1111-1111-1111-111111111111','Candidate — Elena Vasquez','👤',
 '{"area":"Hiring","owner":"ffffffff-ffff-ffff-ffff-ffffffffffff","status":"In review","stage":"Screen","tags":["candidate","backend"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Elena Vasquez — Senior Backend Engineer"},
   {"id":"b2","type":"text","text":"Referred by Diego. Currently at a Series B fintech in Madrid, seven years of experience, strong on Postgres internals and event-driven systems."},
   {"id":"b3","type":"h2","text":"Screen notes"},
   {"id":"b4","type":"bullet","text":"Motivation: wants to work at pre-Series-B stage with a small team."},
   {"id":"b5","type":"bullet","text":"Timeline: available with four weeks notice."},
   {"id":"b6","type":"todo","text":"Schedule hiring-manager conversation with Marco next week."}]'::jsonb,
 'ffffffff-ffff-ffff-ffff-ffffffffffff'),

('22222222-2222-2222-2222-000000000016','11111111-1111-1111-1111-111111111111','Candidate — Kai Nakamura','👤',
 '{"area":"Hiring","owner":"ffffffff-ffff-ffff-ffff-ffffffffffff","status":"In review","stage":"Interview","tags":["candidate","frontend"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Kai Nakamura — Senior Frontend Engineer"},
   {"id":"b2","type":"text","text":"Reached out through the careers page. Deep React and design-system experience, previously shipped the editor at a competitor."},
   {"id":"b3","type":"h2","text":"Progress"},
   {"id":"b4","type":"bullet","text":"Screen: pass. Strong signal on product intuition."},
   {"id":"b5","type":"bullet","text":"Hiring-manager: pass. Comfortable with ambiguous problem statements."},
   {"id":"b6","type":"todo","text":"Technical deep-dive scheduled Friday with Nina and Lena."}]'::jsonb,
 'ffffffff-ffff-ffff-ffff-ffffffffffff'),

('22222222-2222-2222-2222-000000000017','11111111-1111-1111-1111-111111111111','Candidate — Priya Menon','👤',
 '{"area":"Hiring","owner":"ffffffff-ffff-ffff-ffff-ffffffffffff","status":"In review","stage":"Offer","priority":"P1","tags":["candidate","design"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Priya Menon — Product Designer"},
   {"id":"b2","type":"text","text":"Cleared the loop with unanimous support. Portfolio shows a bias for reducing surface area rather than adding it, which matches our design principle."},
   {"id":"b3","type":"h2","text":"Offer"},
   {"id":"b4","type":"bullet","text":"Band: design L4, base €95k, 0.12% equity, four-year vest with one-year cliff."},
   {"id":"b5","type":"bullet","text":"Start date target: September 1."},
   {"id":"b6","type":"todo","text":"Send offer letter by end of day Wednesday."}]'::jsonb,
 'ffffffff-ffff-ffff-ffff-ffffffffffff'),

('22222222-2222-2222-2222-000000000018','11111111-1111-1111-1111-111111111111','Candidate — Jonas Weber','👤',
 '{"area":"Hiring","owner":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","status":"Live","stage":"Hired","tags":["candidate","backend"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Jonas Weber — Staff Backend Engineer"},
   {"id":"b2","type":"text","text":"Accepted offer on July 8, starts August 4. Will anchor the platform team and own the billing rewrite from day one."},
   {"id":"b3","type":"h2","text":"Onboarding"},
   {"id":"b4","type":"bullet","text":"Buddy: Ava. First-week goal is landing a small production change end to end."},
   {"id":"b5","type":"bullet","text":"Introduction at the August 5 all-hands."}]'::jsonb,
 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),

('22222222-2222-2222-2222-000000000019','11111111-1111-1111-1111-111111111111','Hiring plan H2','📋',
 '{"area":"Hiring","owner":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","status":"In review","tags":["hiring","planning"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Hiring plan H2"},
   {"id":"b2","type":"text","text":"We plan five hires between July and December: two senior backend engineers, one senior frontend engineer, one product designer, and one product manager for the growth surface."},
   {"id":"b3","type":"h2","text":"Sourcing mix"},
   {"id":"b4","type":"bullet","text":"Referrals: 40 percent — bonus €3k per hire that clears probation."},
   {"id":"b5","type":"bullet","text":"Outbound: 40 percent — recruiter-led, two batches per role."},
   {"id":"b6","type":"bullet","text":"Inbound: 20 percent — driven by careers page and conference talks."}]'::jsonb,
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),

-- Ops
('22222222-2222-2222-2222-000000000020','11111111-1111-1111-1111-111111111111','Offsite plan — Barcelona','🌴',
 '{"area":"Ops","owner":"cccccccc-cccc-cccc-cccc-cccccccccccc","status":"In review","tags":["offsite","meeting"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Offsite plan — Barcelona"},
   {"id":"b2","type":"text","text":"Company offsite runs October 6 to 10 in Poblenou. Twenty-two attendees. Focus is Q4 planning on the first two days, product deep-dives on the third, and unstructured time on days four and five."},
   {"id":"b3","type":"h2","text":"Logistics"},
   {"id":"b4","type":"bullet","text":"Venue: Nau Bostik, private floor with breakout rooms."},
   {"id":"b5","type":"bullet","text":"Accommodation: Hotel SB Icaria, walking distance from the venue."},
   {"id":"b6","type":"bullet","text":"Dietary requirements collected via the offsite form by September 15."},
   {"id":"b7","type":"todo","text":"Confirm venue deposit and cancellation terms with Nina."}]'::jsonb,
 'cccccccc-cccc-cccc-cccc-cccccccccccc'),

('22222222-2222-2222-2222-000000000021','11111111-1111-1111-1111-111111111111','All-hands notes — Aug 5','📣',
 '{"area":"Ops","owner":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","status":"Live","tags":["meeting","allhands"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"All-hands — August 5"},
   {"id":"b2","type":"h2","text":"Updates"},
   {"id":"b3","type":"bullet","text":"Jonas joined the platform team on Monday. Buddy is Ava."},
   {"id":"b4","type":"bullet","text":"Billing v2 private beta opens August 26 with twelve design partners."},
   {"id":"b5","type":"h2","text":"Questions"},
   {"id":"b6","type":"text","text":"Diego asked how we will measure activation-time improvements once Billing v2 ships. Ava will publish a metric definition by the end of the week."}]'::jsonb,
 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),

-- p22: NO owner property on purpose
('22222222-2222-2222-2222-000000000022','11111111-1111-1111-1111-111111111111','Vendor review notes','🧾',
 '{"area":"Ops","status":"Live","tags":["meeting","vendor"]}'::jsonb,
 '[{"id":"b1","type":"h1","text":"Vendor review — Q3"},
   {"id":"b2","type":"text","text":"Reviewed the four largest recurring vendors: hosting, observability, error tracking, and analytics. Combined spend is on track and roughly flat quarter over quarter."},
   {"id":"b3","type":"h2","text":"Actions"},
   {"id":"b4","type":"bullet","text":"Renegotiate the observability contract before the November renewal — expected 15 percent reduction if we commit annually."},
   {"id":"b5","type":"bullet","text":"Move analytics ingestion off the pay-per-event tier now that volume has stabilised."}]'::jsonb,
 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- 7. Views (7)
INSERT INTO public.views (workspace_id, owner_id, name, scope, layout, group_by, filter, sort, position) VALUES
('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Assigned to me','personal','table',null,
 '[{"prop":"owner","op":"is_me"}]'::jsonb,'{"prop":"edited","dir":"desc"}'::jsonb,1),
('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Recently edited','personal','table',null,
 '[{"prop":"edited","op":"edited_within","value":7}]'::jsonb,'{"prop":"edited","dir":"desc"}'::jsonb,2),
('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Needs review','personal','table',null,
 '[{"prop":"verified","op":"stale"}]'::jsonb,'{"prop":"verified","dir":"asc"}'::jsonb,3),
('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Hiring pipeline','team','board','stage',
 '[{"prop":"area","op":"eq","value":"Hiring"}]'::jsonb,'{"prop":"edited","dir":"desc"}'::jsonb,4),
('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Engineering docs','team','table',null,
 '[{"prop":"area","op":"eq","value":"Engineering"}]'::jsonb,'{"prop":"edited","dir":"desc"}'::jsonb,5),
('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Q3 goals','team','table',null,
 '[{"prop":"tags","op":"includes","value":"q3-goal"}]'::jsonb,'{"prop":"edited","dir":"desc"}'::jsonb,6),
('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Priority: P0','team','table',null,
 '[{"prop":"priority","op":"eq","value":"P0"}]'::jsonb,'{"prop":"edited","dir":"desc"}'::jsonb,7);

-- 8. Deliberate states
-- Two pages verified more than 90 days ago (does not bump edited_at — touch_page only fires on title/blocks/props/icon).
UPDATE public.pages SET verified_at = now() - interval '120 days'
 WHERE id IN ('22222222-2222-2222-2222-000000000003','22222222-2222-2222-2222-000000000013');

-- Restricted page + three per-user access rows (Comp bands)
UPDATE public.pages SET access_type = 'restricted'
 WHERE id = '22222222-2222-2222-2222-000000000014';

INSERT INTO public.page_access (page_id, user_id, capability) VALUES
 ('22222222-2222-2222-2222-000000000014','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','write'),
 ('22222222-2222-2222-2222-000000000014','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','write'),
 ('22222222-2222-2222-2222-000000000014','ffffffff-ffff-ffff-ffff-ffffffffffff','read');

-- Two guest_email access rows on the Priya Menon offer page
INSERT INTO public.page_access (page_id, guest_email, capability) VALUES
 ('22222222-2222-2222-2222-000000000017','candidate@example.com','read'),
 ('22222222-2222-2222-2222-000000000017','recruiter@partner.com','read');