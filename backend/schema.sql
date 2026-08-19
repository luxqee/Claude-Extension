-- Run this once against your Neon database:
--   psql "$DATABASE_URL" -f backend/schema.sql
-- or paste its contents into Neon's SQL Editor
-- (console.neon.tech -> your project -> SQL Editor).

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique
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
-- and RLS default-denies any command with no matching policy. This table
-- has no application write path (the API is read-only) -- the only writer
-- is a trusted human seeding data via direct database access, which is
-- exactly this slice's documented design, so an unconditional insert
-- policy doesn't weaken the SELECT isolation guarantee above.
create policy org_insert on prompts
  for insert
  with check (true);
