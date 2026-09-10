-- Demo organisation data -- populates "Manage Organisation" (shared tabs
-- and prompts, member roster, usage limits, analytics) so the admin view
-- has something to show.
--
-- There is no import for org data (it's all API/DB-backed), so this is a
-- one-off SQL seed. Run it in the Neon SQL Editor.
--
--   1. Sign in to the extension and create your organisation (onboarding).
--   2. Find its id:   select id, name, domain from organizations;
--   3. Paste that id into ORG_ID below (one place) and run the whole file.
--
-- Idempotent: re-running does not duplicate anything. It only adds demo
-- rows -- your own director membership is never touched. The four
-- demo members are fake (nobody signs in as them); they exist so the
-- roster, usage and analytics screens aren't empty.

do $$
declare
  org uuid := 'ORG_ID';   -- <-- paste your organisation id here
  tab_general uuid;
  tab_eng uuid;
  tab_gtm uuid;
  p_summary uuid;
  p_review uuid;
  p_tests uuid;
  p_agenda uuid;
  p_status uuid;
begin
  -- shared tabs -----------------------------------------------------------
  insert into org_tabs (org_id, name, emoji, sort_order)
  select org, v.name, v.emoji, v.ord
  from (values ('General', null::text, 0), ('Engineering', '💻', 1), ('Go-to-market', '📣', 2))
       as v(name, emoji, ord)
  where not exists (select 1 from org_tabs t where t.org_id = org and t.name = v.name);

  select id into tab_general from org_tabs where org_id = org and name = 'General' limit 1;
  select id into tab_eng     from org_tabs where org_id = org and name = 'Engineering' limit 1;
  select id into tab_gtm     from org_tabs where org_id = org and name = 'Go-to-market' limit 1;

  -- shared prompts ------------------------------------------------------
  insert into prompts (org_id, name, prompt_text, type, tab_id, sort_order)
  select org, v.name, v.body, 'prompt', v.tab, v.ord
  from (values
    ('Summarize thread', 'Summarize the conversation above into 3-5 bullets. Keep names and numbers exact.', tab_general, 0),
    ('Reply draft',      'Draft a short reply to the message above: decision first, then two sentences of reasoning.', tab_general, 1),
    ('Review for bugs',  'Review the code above for bugs and edge cases. For each: failing input, what breaks, smallest fix.', tab_eng, 0),
    ('Write tests',      'Write unit tests for the code above: normal case, boundaries, one failure case.', tab_eng, 1),
    ('Incident update',  'Write a 4-line incident update from the notes above: Impact, Cause, Fix, Next.', tab_eng, 2),
    ('Meeting agenda',   'Turn the topics above into a time-boxed 30-minute agenda; each item gets a goal and the decision it needs.', tab_gtm, 0),
    ('Status update',    'Write a status update from the notes above: Done, In progress, Blocked, Next.', tab_gtm, 1),
    ('Positioning pass', 'Rewrite the paragraph above to lead with the customer outcome, not the feature. Same length.', tab_gtm, 2)
  ) as v(name, body, tab, ord)
  where not exists (select 1 from prompts p where p.org_id = org and p.name = v.name);

  select id into p_summary from prompts where org_id = org and name = 'Summarize thread' limit 1;
  select id into p_review  from prompts where org_id = org and name = 'Review for bugs' limit 1;
  select id into p_tests   from prompts where org_id = org and name = 'Write tests' limit 1;
  select id into p_agenda  from prompts where org_id = org and name = 'Meeting agenda' limit 1;
  select id into p_status  from prompts where org_id = org and name = 'Status update' limit 1;

  -- demo members --------------------------------------------------------
  insert into org_members (org_id, email, role, status, invited_by) values
    (org, 'dana@demo.example', 'member', 'active',  'seed'),
    (org, 'ravi@demo.example', 'member', 'active',  'seed'),
    (org, 'mei@demo.example',  'member', 'active',  'seed'),
    (org, 'sam@demo.example',  'member', 'pending', 'seed')
  on conflict (org_id, lower(email)) do nothing;

  -- usage limits (session / weekly / spend %) --------------------------
  insert into usage_snapshots (org_id, email, session_percent, weekly_percent, spend_percent, updated_at) values
    (org, 'dana@demo.example', 42, 71, 18, now()),
    (org, 'ravi@demo.example', 88, 55, 34, now()),
    (org, 'mei@demo.example',  12, 20,  5, now())
  on conflict (org_id, email) do update set
    session_percent = excluded.session_percent,
    weekly_percent  = excluded.weekly_percent,
    spend_percent   = excluded.spend_percent,
    updated_at      = now();

  -- prompt-run counters (Analytics: Prompt runs / Top prompts / Per member)
  insert into org_prompt_usage (org_id, prompt_id, email, run_count, last_used_at) values
    (org, p_summary, 'dana@demo.example', 37, now() - interval '2 hours'),
    (org, p_review,  'ravi@demo.example', 24, now() - interval '1 day'),
    (org, p_tests,   'ravi@demo.example', 11, now() - interval '3 days'),
    (org, p_agenda,  'mei@demo.example',   8, now() - interval '5 hours'),
    (org, p_status,  'dana@demo.example',  5, now() - interval '6 days'),
    (org, p_summary, 'mei@demo.example',   3, now() - interval '2 days')
  on conflict (org_id, prompt_id, email) do update set
    run_count    = excluded.run_count,
    last_used_at = excluded.last_used_at;

  raise notice 'seeded org %: % tabs, % prompts, % members',
    org,
    (select count(*) from org_tabs   where org_id = org),
    (select count(*) from prompts    where org_id = org),
    (select count(*) from org_members where org_id = org);
end $$;
