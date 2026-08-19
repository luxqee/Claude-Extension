-- Run this once against your Neon database:
--   psql "$DATABASE_URL" -f backend/schema.sql
-- or paste its contents into Neon's SQL Editor
-- (console.neon.tech -> your project -> SQL Editor).
--
-- If you already ran an earlier version of this file (Phase 2C or
-- earlier), run this instead to migrate in place rather than starting
-- over:
--   alter table organizations drop constraint organizations_domain_key;
-- then paste in everything below the `create table org_members` line.
--
-- If you already applied an earlier version of this file with the old
-- org_members_isolation SELECT policy (org_id-scoped), fix it in place:
--   drop policy org_members_isolation on org_members;
--   create policy org_members_isolation on org_members for select using (true);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null
  -- No longer unique: public/consumer domains (gmail.com, etc.) will
  -- legitimately have many unrelated organizations sharing the same
  -- domain value, since domain-based auto-join never applies to them.
  -- "One organization per real company domain" is enforced at the
  -- application layer instead (see Task 2).
);

create table prompts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  prompt_text text not null,
  type text not null check (type in ('prompt', 'skill')),
  created_at timestamptz not null default now()
);

alter table prompts enable row level security;
alter table prompts force row level security;

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
create policy org_insert on prompts
  for insert
  with check (true);

create policy org_update on prompts
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);

create policy org_delete on prompts
  for delete
  using (org_id = current_setting('app.current_org_id', true)::uuid);

create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null,
  role text not null check (role in ('director', 'member')),
  status text not null check (status in ('pending', 'active')),
  invited_by text,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

alter table org_members enable row level security;
alter table org_members force row level security;

-- Deliberately unconditional, matching org_members_insert below and this
-- project's established reasoning for prompts' own insert policy: RLS has
-- no way to verify which end-user identity a query is acting on -- only
-- the API layer can, via a verified Google ID token, and every read of
-- this table already derives its own authorization from that (a caller's
-- own verified email for self-lookups, or an already-authorized org_id
-- for roster listings). An org_id-scoped SELECT policy here is not just
-- unhelpful but actively breaks the product: several call sites query
-- org_members BY EMAIL specifically to discover which org someone
-- belongs to, and cannot know org_id in advance -- finding it out is the
-- entire point of the query. A scoped policy makes every such lookup
-- return zero rows unconditionally, since the session variable it
-- requires can never be set before the org_id it would need is known.
create policy org_members_isolation on org_members
  for select
  using (true);

create policy org_members_insert on org_members
  for insert
  with check (true);

create policy org_members_update on org_members
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);

create policy org_members_delete on org_members
  for delete
  using (org_id = current_setting('app.current_org_id', true)::uuid);

create table usage_snapshots (
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

create policy usage_snapshots_isolation on usage_snapshots
  for select
  using (org_id = current_setting('app.current_org_id', true)::uuid);

create policy usage_snapshots_insert on usage_snapshots
  for insert
  with check (true);

create policy usage_snapshots_update on usage_snapshots
  for update
  using (org_id = current_setting('app.current_org_id', true)::uuid);
