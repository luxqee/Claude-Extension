-- Run this against your Neon database:
--   psql "$DATABASE_URL" -f backend/schema.sql
-- or paste its contents into Neon's SQL Editor
-- (console.neon.tech -> your project -> SQL Editor).
--
-- The whole file is idempotent -- every `create table` is `if not exists`
-- and every policy is dropped-then-created -- so pasting it into a
-- database that already has some or all of these objects is safe and is
-- the intended way to pick up newly added tables (e.g. `rate_limits`).
--
-- Migrating from the pre-Phase-2C schema (unique constraint on
-- organizations.domain, or a case-sensitive org_members unique):
--   alter table organizations drop constraint if exists organizations_domain_key;
--   alter table org_members drop constraint if exists org_members_org_id_email_key;
--   update org_members set email = lower(email) where email <> lower(email);
-- then run this file.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null
  -- No longer unique: public/consumer domains (gmail.com, etc.) will
  -- legitimately have many unrelated organizations sharing the same
  -- domain value, since domain-based auto-join never applies to them.
  -- "One organization per real company domain" is enforced at the
  -- application layer instead (see Task 2).
);

create table if not exists prompts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  prompt_text text not null,
  type text not null check (type in ('prompt', 'skill')),
  created_at timestamptz not null default now()
);

alter table prompts enable row level security;
alter table prompts force row level security;

drop policy if exists org_isolation on prompts;
create policy org_isolation on prompts
  for select
  using (org_id = current_setting('app.current_org_id', true)::uuid);

-- FORCE (above) also applies to INSERT/UPDATE/DELETE for the owning role,
-- and RLS default-denies any command with no matching policy. Prompts now
-- have a real application write path (Task 4's director-only CRUD
-- endpoints) rather than only direct-database seeding, so this policy
-- allows any insert and relies on the API layer to check the caller is a
-- director of the target org_id before ever running one -- the same
-- defense-in-depth split as the org_members/usage_snapshots policies
-- below (RLS proves org isolation; the API proves authorization).
drop policy if exists org_insert on prompts;
create policy org_insert on prompts
  for insert
  with check (true);

drop policy if exists org_update on prompts;
create policy org_update on prompts
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);

drop policy if exists org_delete on prompts;
create policy org_delete on prompts
  for delete
  using (org_id = current_setting('app.current_org_id', true)::uuid);

create table if not exists org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null,
  role text not null check (role in ('director', 'member')),
  status text not null check (status in ('pending', 'active')),
  invited_by text,
  created_at timestamptz not null default now()
);

-- Case-insensitive on purpose, rather than a plain `unique (org_id, email)`.
-- Every read of this table compares with lower(email) (org-session,
-- require-director, org-prompts, usage-report, and every members endpoint),
-- and every write site lowercases before inserting, so the uniqueness
-- guarantee has to be stated the same way. With a case-sensitive constraint
-- Alice@acme.com and alice@acme.com would be two rows for one person, and
-- since session/role resolution picks a single row per email, the duplicate
-- could silently supersede -- and effectively demote -- the real one.
-- ON CONFLICT clauses against this table must name the expression form
-- (`on conflict (org_id, lower(email))`) so the inference matches this index.
create unique index if not exists org_members_org_email_key on org_members (org_id, lower(email));

alter table org_members enable row level security;
alter table org_members force row level security;

-- Deliberately unconditional, matching org_members_insert below and this
-- project's established reasoning for prompts' own insert policy: RLS has
-- no way to verify which end-user identity a query is acting on -- only
-- the API layer can, via a verified identity token, and every read of
-- this table already derives its own authorization from that (a caller's
-- own verified email for self-lookups, or an already-authorized org_id
-- for roster listings). An org_id-scoped SELECT policy here is not just
-- unhelpful but actively breaks the product: several call sites query
-- org_members BY EMAIL specifically to discover which org someone
-- belongs to, and cannot know org_id in advance -- finding it out is the
-- entire point of the query. A scoped policy makes every such lookup
-- return zero rows unconditionally, since the session variable it
-- requires can never be set before the org_id it would need is known.
drop policy if exists org_members_isolation on org_members;
create policy org_members_isolation on org_members
  for select
  using (true);

drop policy if exists org_members_insert on org_members;
create policy org_members_insert on org_members
  for insert
  with check (true);

drop policy if exists org_members_update on org_members;
create policy org_members_update on org_members
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);

drop policy if exists org_members_delete on org_members;
create policy org_members_delete on org_members
  for delete
  using (org_id = current_setting('app.current_org_id', true)::uuid);

create table if not exists usage_snapshots (
  org_id uuid not null references organizations(id),
  email text not null,
  session_percent integer,
  weekly_percent integer,
  spend_percent integer,
  updated_at timestamptz not null default now(),
  primary key (org_id, email)
);

alter table usage_snapshots enable row level security;
alter table usage_snapshots force row level security;

drop policy if exists usage_snapshots_isolation on usage_snapshots;
create policy usage_snapshots_isolation on usage_snapshots
  for select
  using (org_id = current_setting('app.current_org_id', true)::uuid);

drop policy if exists usage_snapshots_insert on usage_snapshots;
create policy usage_snapshots_insert on usage_snapshots
  for insert
  with check (true);

drop policy if exists usage_snapshots_update on usage_snapshots;
create policy usage_snapshots_update on usage_snapshots
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);

-- ===========================================================================
-- Phase 5: organisation shared tabs, and Phase 9: prompt-run analytics.
--
-- Migrating an existing database in place (rather than starting fresh):
-- run everything from this line to the end of the file. It is all additive
-- (new tables, two nullable/defaulted columns on `prompts`) and fully
-- re-runnable -- every `create table` is `if not exists`, every policy is
-- dropped-then-created, and the backfill block only touches prompts whose
-- tab_id is still null.
-- ===========================================================================

create table if not exists org_tabs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  emoji text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table org_tabs enable row level security;
alter table org_tabs force row level security;

-- Same defense-in-depth split as prompts/org_members: RLS proves org
-- isolation on read; the API layer proves the caller is a director of the
-- target org before any write. Hence the unconditional insert policy.
drop policy if exists org_tabs_isolation on org_tabs;
create policy org_tabs_isolation on org_tabs
  for select
  using (org_id = current_setting('app.current_org_id', true)::uuid);

drop policy if exists org_tabs_insert on org_tabs;
create policy org_tabs_insert on org_tabs
  for insert
  with check (true);

drop policy if exists org_tabs_update on org_tabs;
create policy org_tabs_update on org_tabs
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);

drop policy if exists org_tabs_delete on org_tabs;
create policy org_tabs_delete on org_tabs
  for delete
  using (org_id = current_setting('app.current_org_id', true)::uuid);

alter table prompts add column if not exists tab_id uuid references org_tabs(id);
alter table prompts add column if not exists sort_order integer not null default 0;

-- Backfill: give every organisation that has prompts a "General" tab and
-- move its prompts into it. Idempotent -- only touches prompts whose
-- tab_id is still null.
do $$
declare
  o record;
  new_tab uuid;
begin
  for o in select distinct org_id from prompts where tab_id is null loop
    insert into org_tabs (org_id, name, sort_order)
    values (o.org_id, 'General', 0)
    returning id into new_tab;
    update prompts set tab_id = new_tab where org_id = o.org_id and tab_id is null;
  end loop;
end $$;

-- --- Phase 9 analytics ---

-- Lifetime run counters, one row per (prompt, member). Upserted on each
-- reported prompt run. `on delete cascade` on prompt_id so removing a
-- shared prompt takes its usage rows with it.
create table if not exists org_prompt_usage (
  org_id uuid not null references organizations(id),
  prompt_id uuid not null references prompts(id) on delete cascade,
  email text not null,
  run_count integer not null default 0,
  last_used_at timestamptz not null default now(),
  primary key (org_id, prompt_id, email)
);

alter table org_prompt_usage enable row level security;
alter table org_prompt_usage force row level security;

drop policy if exists org_prompt_usage_isolation on org_prompt_usage;
create policy org_prompt_usage_isolation on org_prompt_usage
  for select
  using (org_id = current_setting('app.current_org_id', true)::uuid);

drop policy if exists org_prompt_usage_insert on org_prompt_usage;
create policy org_prompt_usage_insert on org_prompt_usage
  for insert
  with check (true);

drop policy if exists org_prompt_usage_update on org_prompt_usage;
create policy org_prompt_usage_update on org_prompt_usage
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);

-- Org-wide daily run totals, for the "runs over time" chart only. No
-- per-prompt or per-member breakdown here -- that comes from
-- org_prompt_usage. Rows older than 30 days are pruned on each write, so
-- this table stays tiny and needs no separate retention job.
create table if not exists org_daily_runs (
  org_id uuid not null references organizations(id),
  day date not null,
  run_count integer not null default 0,
  primary key (org_id, day)
);

alter table org_daily_runs enable row level security;
alter table org_daily_runs force row level security;

drop policy if exists org_daily_runs_isolation on org_daily_runs;
create policy org_daily_runs_isolation on org_daily_runs
  for select
  using (org_id = current_setting('app.current_org_id', true)::uuid);

drop policy if exists org_daily_runs_insert on org_daily_runs;
create policy org_daily_runs_insert on org_daily_runs
  for insert
  with check (true);

drop policy if exists org_daily_runs_update on org_daily_runs;
create policy org_daily_runs_update on org_daily_runs
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);

drop policy if exists org_daily_runs_delete on org_daily_runs;
create policy org_daily_runs_delete on org_daily_runs
  for delete
  using (org_id = current_setting('app.current_org_id', true)::uuid);

-- ===========================================================================
-- Rate limiting (fixed-window). Not org-scoped, so no RLS -- one row per
-- (route, caller) bucket, rewritten in place each window. Safe to re-run.
-- Migrating in place: just run this block.
-- ===========================================================================

create table if not exists rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

create index if not exists rate_limits_window_start_idx on rate_limits (window_start);
