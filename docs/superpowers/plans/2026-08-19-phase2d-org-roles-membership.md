# Phase 2D: Organization Roles, Membership & Prompt Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real persisted org membership with director/member roles and an approval flow, director CRUD on org prompts, and per-member usage-percentage reporting visible to directors — replacing Phase 2C's pure domain-matching with a real membership model.

**Architecture:** Two new Postgres tables (`org_members`, `usage_snapshots`) behind new Vercel endpoints, mirroring the existing `org-prompts.ts` handler's token-verification and RLS conventions. The extension gets new shared client modules (one per endpoint group, matching `org-prompts.ts`'s existing shape) and new sidepanel views wired through `main.ts`/`render.ts`.

**Tech Stack:** Backend: TypeScript, Vercel serverless functions, `@neondatabase/serverless`, `google-auth-library`, Vitest. Extension: TypeScript + Vite (CRXJS), pnpm, vanilla TS + DOM, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-phase2d-org-roles-membership-design.md`

## Global Constraints

- Package manager is pnpm, never npm, in both the repo root and `backend/`.
- No new npm dependencies in either the extension or the backend.
- Backend API base URL: `https://claude-extension-git-main-luxqees-projects.vercel.app` (already in the extension's `host_permissions` and in `src/shared/org-prompts.ts`'s `API_BASE_URL` constant — reuse it, don't redefine it per-module).
- Every director-only backend endpoint re-checks the caller's own `org_members` row (`role: 'director'`, `status: 'active'`) from their verified token email on every request — never trust a client-supplied role.
- The last-director guard (no organization may drop to zero active directors) is enforced server-side in `remove` and `set-role`, not only in the UI.
- `usage_snapshots` stores latest-only (upsert), never a history table, per the spec's "least data collected" NFR.
- No separate "Personal" sign-in flow — personal buttons already work with zero sign-in; the only button is "Sign in with your organisation."
- Testing convention (from the spec): backend resolution-order logic and the last-director guard are pure functions with full TDD coverage; extension-side response parsing/shaping gets TDD in `tests/shared/`; DOM/`chrome.identity`/`chrome.tabs`/timer-driven UI is manual-verification-only, matching every prior UI task in this project.
- Run `pnpm test && pnpm run build` (repo root) and `pnpm test && pnpm typecheck` (inside `backend/`) at the end of every task touching that half of the codebase; both must be clean before committing.
- RLS: every new table gets `enable row level security` + `force row level security` + a policy scoped to `current_setting('app.current_org_id', true)::uuid`, matching `prompts`' existing pattern in `backend/schema.sql`.

---

### Task 1: Schema migration + public-domain blocklist helper

**Files:**
- Modify: `backend/schema.sql`
- Modify: `backend/lib/resolve-org.ts`
- Modify: `backend/lib/resolve-org.test.ts`

**Interfaces:**
- Produces: `org_members` and `usage_snapshots` tables (schema only, no application code yet — later tasks query them directly). `isPublicEmailDomain(domain: string): boolean`, exported from `backend/lib/resolve-org.ts`, consumed by Task 2's session-resolution logic.
- Consumes: nothing from other tasks (this is the foundation task).

This task has no live-database step — `schema.sql` is applied manually against Neon (documented in `backend/README.md`, updated in this task), not run by any test. The pure helper (`isPublicEmailDomain`) is fully TDD'd.

- [ ] **Step 1: Write the failing tests for the public-domain helper**

Add to `backend/lib/resolve-org.test.ts` (append after the existing `resolveOrgId` describe block):

```ts
describe('isPublicEmailDomain', () => {
  it('returns true for gmail.com', () => {
    expect(isPublicEmailDomain('gmail.com')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(isPublicEmailDomain('GMAIL.COM')).toBe(true)
  })

  it('returns true for outlook.com, hotmail.com, yahoo.com, icloud.com', () => {
    expect(isPublicEmailDomain('outlook.com')).toBe(true)
    expect(isPublicEmailDomain('hotmail.com')).toBe(true)
    expect(isPublicEmailDomain('yahoo.com')).toBe(true)
    expect(isPublicEmailDomain('icloud.com')).toBe(true)
  })

  it('returns false for a real company domain', () => {
    expect(isPublicEmailDomain('acme.com')).toBe(false)
  })
})
```

Update the import line at the top of `backend/lib/resolve-org.test.ts` from:

```ts
import { resolveOrgId } from './resolve-org'
```

to:

```ts
import { resolveOrgId, isPublicEmailDomain } from './resolve-org'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `pnpm test -- resolve-org.test.ts`
Expected: FAIL — `isPublicEmailDomain is not a function` (or similar import error).

- [ ] **Step 3: Implement `isPublicEmailDomain`**

In `backend/lib/resolve-org.ts`, add below the existing imports/before `resolveOrgId`:

```ts
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'zoho.com',
])

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `pnpm test -- resolve-org.test.ts`
Expected: PASS, all tests green (existing `resolveOrgId` tests plus the new `isPublicEmailDomain` ones).

- [ ] **Step 5: Migrate the schema**

Replace the full contents of `backend/schema.sql` with:

```sql
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
-- have a real application write path (Task 5's director-only CRUD
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

create policy org_members_isolation on org_members
  for select
  using (org_id = current_setting('app.current_org_id', true)::uuid);

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
```

- [ ] **Step 6: Update `backend/README.md`'s database setup section**

In `backend/README.md`, replace the `## Database setup` section's seeding example paragraph (the one starting "Then seed at least one organization directly") with:

```markdown
If you're migrating an existing database from Phase 2C rather than
starting fresh, first run:

```sql
alter table organizations drop constraint organizations_domain_key;
```

then apply everything from `create table org_members` onward in
`schema.sql`.

Organizations, membership, and prompts are now created and managed
through the API (`POST /api/org-onboarding`, the `org_members` and
`org_prompts` endpoints — see below) rather than by hand. Direct SQL
seeding is still useful for local testing:

```sql
insert into organizations (name, domain) values ('Your Company', 'yourcompany.com')
returning id;
-- then, using the returned id:
insert into org_members (org_id, email, role, status) values
  ('<org-id>', 'you@yourcompany.com', 'director', 'active');
```
```

- [ ] **Step 7: Run the backend test suite and typecheck**

Run (from `backend/`): `pnpm test && pnpm typecheck`
Expected: all tests pass (existing `org-prompts` coverage plus the new `isPublicEmailDomain` tests), typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add backend/schema.sql backend/lib/resolve-org.ts backend/lib/resolve-org.test.ts backend/README.md
git commit -m "feat: add org_members/usage_snapshots schema and public-domain blocklist"
```

---

### Task 2: Org-session resolution + onboarding endpoints

**Files:**
- Create: `backend/lib/resolve-session.ts`
- Create: `backend/lib/resolve-session.test.ts`
- Create: `backend/api/org-session.ts`
- Create: `backend/api/org-onboarding.ts`

**Interfaces:**
- Consumes: `resolveOrgId`, `isPublicEmailDomain`, `OrgRecord` from `backend/lib/resolve-org.ts` (Task 1).
- Produces: `resolveSessionState(email, existingMember, orgs): SessionResolution` and the `OrgMemberRecord`/`SessionResolution` types, consumed by Task 3's membership endpoints (same `OrgMemberRecord` shape). `POST /api/org-session` and `POST /api/org-onboarding` HTTP endpoints, consumed by Task 6 (extension client).

This task's pure resolution logic gets full TDD; the two handlers (DB reads/writes, token verification) follow `backend/api/org-prompts.ts`'s existing convention of being verified live after deployment, not unit tested.

- [ ] **Step 1: Write the failing tests for the pure resolution logic**

Create `backend/lib/resolve-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveSessionState } from './resolve-session'

const ORGS = [{ id: 'org-1', domain: 'acme.com' }]

describe('resolveSessionState', () => {
  it('returns active with role for an existing active member', () => {
    const member = { orgId: 'org-1', email: 'alice@acme.com', role: 'director' as const, status: 'active' as const }
    expect(resolveSessionState('alice@acme.com', member, ORGS)).toEqual({
      state: 'active',
      orgId: 'org-1',
      role: 'director',
    })
  })

  it('returns pending for an existing pending member, without re-checking domain', () => {
    const member = { orgId: 'org-1', email: 'bob@acme.com', role: 'member' as const, status: 'pending' as const }
    expect(resolveSessionState('bob@acme.com', member, ORGS)).toEqual({ state: 'pending', orgId: 'org-1' })
  })

  it('returns pending for a new email matching an existing non-public org domain', () => {
    expect(resolveSessionState('carol@acme.com', null, ORGS)).toEqual({ state: 'pending', orgId: 'org-1' })
  })

  it('returns needs_onboarding for a new email at an unknown company domain', () => {
    expect(resolveSessionState('dave@unknown.com', null, ORGS)).toEqual({ state: 'needs_onboarding' })
  })

  it('returns needs_onboarding for a new email at a public domain, even if an org happens to share that domain value', () => {
    const orgsWithPublicDomain = [...ORGS, { id: 'org-2', domain: 'gmail.com' }]
    expect(resolveSessionState('erin@gmail.com', null, orgsWithPublicDomain)).toEqual({
      state: 'needs_onboarding',
    })
  })

  it('returns needs_onboarding for an email with no @ sign', () => {
    expect(resolveSessionState('not-an-email', null, ORGS)).toEqual({ state: 'needs_onboarding' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `pnpm test -- resolve-session.test.ts`
Expected: FAIL — `Cannot find module './resolve-session'`.

- [ ] **Step 3: Implement the pure resolution logic**

Create `backend/lib/resolve-session.ts`:

```ts
import { resolveOrgId, isPublicEmailDomain, type OrgRecord } from './resolve-org.js'

export interface OrgMemberRecord {
  orgId: string
  email: string
  role: 'director' | 'member'
  status: 'pending' | 'active'
}

export type SessionResolution =
  | { state: 'active'; orgId: string; role: 'director' | 'member' }
  | { state: 'pending'; orgId: string }
  | { state: 'needs_onboarding' }

export function resolveSessionState(
  email: string,
  existingMember: OrgMemberRecord | null,
  orgs: OrgRecord[],
): SessionResolution {
  if (existingMember) {
    return existingMember.status === 'active'
      ? { state: 'active', orgId: existingMember.orgId, role: existingMember.role }
      : { state: 'pending', orgId: existingMember.orgId }
  }

  const atIndex = email.lastIndexOf('@')
  if (atIndex === -1 || atIndex === email.length - 1) return { state: 'needs_onboarding' }

  const domain = email.slice(atIndex + 1).toLowerCase()
  if (isPublicEmailDomain(domain)) return { state: 'needs_onboarding' }

  const orgId = resolveOrgId(email, orgs)
  if (!orgId) return { state: 'needs_onboarding' }

  return { state: 'pending', orgId }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `pnpm test -- resolve-session.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Implement `POST /api/org-session`**

Create `backend/api/org-session.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { type OrgRecord } from '../lib/resolve-org.js'
import { resolveSessionState, type OrgMemberRecord } from '../lib/resolve-session.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

interface OrgRow extends OrgRecord {
  name: string
}

interface MemberRow {
  org_id: string
  email: string
  role: 'director' | 'member'
  status: 'pending' | 'active'
}

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-session] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyEmail(idToken)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  try {
    const [orgs, memberRows] = await Promise.all([
      sql`SELECT id, name, domain FROM organizations` as Promise<OrgRow[]>,
      sql`SELECT org_id, email, role, status FROM org_members WHERE lower(email) = lower(${email}) ORDER BY created_at DESC LIMIT 1` as Promise<
        MemberRow[]
      >,
    ])

    const existingMember: OrgMemberRecord | null = memberRows[0]
      ? {
          orgId: memberRows[0].org_id,
          email: memberRows[0].email,
          role: memberRows[0].role,
          status: memberRows[0].status,
        }
      : null

    const resolution = resolveSessionState(email, existingMember, orgs)

    if (resolution.state === 'needs_onboarding') {
      res.status(200).json({ state: 'needs_onboarding' })
      return
    }

    if (resolution.state === 'active') {
      const org = orgs.find((candidate) => candidate.id === resolution.orgId)
      res.status(200).json({
        state: 'active',
        org: { id: resolution.orgId, name: org?.name ?? '' },
        role: resolution.role,
      })
      return
    }

    // state === 'pending'. If there was no existing row, this is a
    // brand-new domain auto-join -- create the pending row now.
    if (!existingMember) {
      await sql`
        INSERT INTO org_members (org_id, email, role, status)
        VALUES (${resolution.orgId}, ${email}, 'member', 'pending')
        ON CONFLICT (org_id, email) DO NOTHING
      `
    }
    const org = orgs.find((candidate) => candidate.id === resolution.orgId)
    res.status(200).json({ state: 'pending', org: { id: resolution.orgId, name: org?.name ?? '' } })
  } catch (error) {
    console.error('[org-session] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 6: Implement `POST /api/org-onboarding`**

Create `backend/api/org-onboarding.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveOrgId, isPublicEmailDomain, type OrgRecord } from '../lib/resolve-org.js'
import { resolveSessionState, type OrgMemberRecord } from '../lib/resolve-session.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

interface OrgRow extends OrgRecord {
  name: string
}

interface MemberRow {
  org_id: string
  email: string
  role: 'director' | 'member'
  status: 'pending' | 'active'
}

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-onboarding] token verification failed', error)
    return null
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyEmail(idToken)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { orgName?: unknown; initialMemberEmails?: unknown }
  if (!isNonEmptyString(body.orgName)) {
    res.status(400).json({ error: 'orgName is required' })
    return
  }
  const orgName = body.orgName.trim()
  const initialMemberEmails = Array.isArray(body.initialMemberEmails)
    ? body.initialMemberEmails.filter(isNonEmptyString).map((e) => e.trim().toLowerCase())
    : []

  const atIndex = email.lastIndexOf('@')
  if (atIndex === -1 || atIndex === email.length - 1) {
    res.status(400).json({ error: 'invalid email' })
    return
  }
  const domain = email.slice(atIndex + 1).toLowerCase()

  try {
    const [orgs, memberRows] = await Promise.all([
      sql`SELECT id, name, domain FROM organizations` as Promise<OrgRow[]>,
      sql`SELECT org_id, email, role, status FROM org_members WHERE lower(email) = lower(${email}) ORDER BY created_at DESC LIMIT 1` as Promise<
        MemberRow[]
      >,
    ])
    const existingMember: OrgMemberRecord | null = memberRows[0]
      ? {
          orgId: memberRows[0].org_id,
          email: memberRows[0].email,
          role: memberRows[0].role,
          status: memberRows[0].status,
        }
      : null

    if (resolveSessionState(email, existingMember, orgs).state !== 'needs_onboarding') {
      res.status(409).json({ error: 'already a member of an organization' })
      return
    }

    // Best-effort race guard for real company domains: if another request
    // created an org for this exact domain between our read above and now,
    // join it as a pending member instead of creating a duplicate. This is
    // not a hard database guarantee (no unique constraint backs it, since
    // public domains must never be deduplicated this way) -- an extremely
    // tight simultaneous race could still create two organizations for the
    // same brand-new domain. Accepted, documented low-probability edge
    // case, not a correctness or security issue.
    if (!isPublicEmailDomain(domain)) {
      const raceOrgId = resolveOrgId(email, orgs)
      if (raceOrgId) {
        await sql`
          INSERT INTO org_members (org_id, email, role, status)
          VALUES (${raceOrgId}, ${email}, 'member', 'pending')
          ON CONFLICT (org_id, email) DO NOTHING
        `
        const org = orgs.find((candidate) => candidate.id === raceOrgId)
        res.status(200).json({ outcome: 'joined_existing', org: { id: raceOrgId, name: org?.name ?? '' } })
        return
      }
    }

    const [createdOrg] = (await sql`
      INSERT INTO organizations (name, domain) VALUES (${orgName}, ${domain}) RETURNING id, name
    `) as { id: string; name: string }[]

    await sql`
      INSERT INTO org_members (org_id, email, role, status) VALUES (${createdOrg.id}, ${email}, 'director', 'active')
    `

    for (const memberEmail of initialMemberEmails) {
      if (memberEmail === email.toLowerCase()) continue
      await sql`
        INSERT INTO org_members (org_id, email, role, status, invited_by)
        VALUES (${createdOrg.id}, ${memberEmail}, 'member', 'active', ${email})
        ON CONFLICT (org_id, email) DO NOTHING
      `
    }

    res.status(200).json({ outcome: 'created', org: { id: createdOrg.id, name: createdOrg.name }, role: 'director' })
  } catch (error) {
    console.error('[org-onboarding] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 7: Update `backend/README.md`'s API section**

In `backend/README.md`, append after the existing `GET /api/org-prompts` block under `## API`:

```markdown
```
POST /api/org-session
Authorization: Bearer <google-id-token>

200 -> { "state": "active", "org": { "id": "...", "name": "..." }, "role": "director" | "member" }
200 -> { "state": "pending", "org": { "id": "...", "name": "..." } }
200 -> { "state": "needs_onboarding" }
401 -> token missing or invalid
```

```
POST /api/org-onboarding
Authorization: Bearer <google-id-token>
Body: { "orgName": "...", "initialMemberEmails": ["...", "..."] }

200 -> { "outcome": "created", "org": { "id": "...", "name": "..." }, "role": "director" }
200 -> { "outcome": "joined_existing", "org": { "id": "...", "name": "..." } }
400 -> orgName missing/empty, or invalid email
401 -> token missing or invalid
409 -> already a member of an organization
```
```

- [ ] **Step 8: Run the backend test suite and typecheck**

Run (from `backend/`): `pnpm test && pnpm typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add backend/lib/resolve-session.ts backend/lib/resolve-session.test.ts backend/api/org-session.ts backend/api/org-onboarding.ts backend/README.md
git commit -m "feat: add org-session resolution and org-onboarding endpoints"
```

---

### Task 3: Director-only membership management endpoints

**Files:**
- Create: `backend/lib/require-director.ts`
- Create: `backend/lib/last-director-guard.ts`
- Create: `backend/lib/last-director-guard.test.ts`
- Create: `backend/api/org-members.ts`
- Create: `backend/api/org-members-approve.ts`
- Create: `backend/api/org-members-remove.ts`
- Create: `backend/api/org-members-add.ts`
- Create: `backend/api/org-members-set-role.ts`

**Interfaces:**
- Consumes: `OrgMemberRecord` shape from Task 2 (`backend/lib/resolve-session.ts`), `neon` client pattern from `backend/api/org-prompts.ts`.
- Produces: `resolveDirectorContext(sql, email): Promise<{ orgId, email } | null>` from `backend/lib/require-director.ts`, reused by Task 4's prompt-CRUD endpoints. `isLastActiveDirector(target, otherActiveDirectorCount): boolean` from `backend/lib/last-director-guard.ts`. Five HTTP endpoints, consumed by Task 7 (extension client).

The last-director guard is a pure function with full TDD. The five handlers follow the same live-verification convention as `org-prompts.ts`.

- [ ] **Step 1: Write the failing tests for the last-director guard**

Create `backend/lib/last-director-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isLastActiveDirector } from './last-director-guard'

describe('isLastActiveDirector', () => {
  it('returns true for an active director with no other active directors', () => {
    expect(isLastActiveDirector({ role: 'director', status: 'active' }, 0)).toBe(true)
  })

  it('returns false for an active director when another active director exists', () => {
    expect(isLastActiveDirector({ role: 'director', status: 'active' }, 1)).toBe(false)
  })

  it('returns false for a regular member regardless of other-director count', () => {
    expect(isLastActiveDirector({ role: 'member', status: 'active' }, 0)).toBe(false)
  })

  it('returns false for a pending director (not yet active)', () => {
    expect(isLastActiveDirector({ role: 'director', status: 'pending' }, 0)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `pnpm test -- last-director-guard.test.ts`
Expected: FAIL — `Cannot find module './last-director-guard'`.

- [ ] **Step 3: Implement the guard**

Create `backend/lib/last-director-guard.ts`:

```ts
export interface MemberRoleStatus {
  role: 'director' | 'member'
  status: 'pending' | 'active'
}

export function isLastActiveDirector(target: MemberRoleStatus, otherActiveDirectorCount: number): boolean {
  return target.role === 'director' && target.status === 'active' && otherActiveDirectorCount === 0
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `pnpm test -- last-director-guard.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Implement the shared director-context helper**

Create `backend/lib/require-director.ts`:

```ts
import type { neon } from '@neondatabase/serverless'

type Sql = ReturnType<typeof neon>

export interface DirectorContext {
  orgId: string
  email: string
}

export async function resolveDirectorContext(sql: Sql, email: string): Promise<DirectorContext | null> {
  const rows = (await sql`
    SELECT org_id FROM org_members
    WHERE lower(email) = lower(${email}) AND role = 'director' AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `) as { org_id: string }[]
  return rows[0] ? { orgId: rows[0].org_id, email } : null
}
```

- [ ] **Step 6: Implement `GET /api/org-members`**

Create `backend/api/org-members.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../lib/require-director.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-members] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const callerEmail = await verifyEmail(idToken)
  if (!callerEmail) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`SELECT email, role, status, created_at FROM org_members WHERE org_id = ${director.orgId} ORDER BY created_at ASC`,
    ])
    const members = results[1] as { email: string; role: string; status: string; created_at: string }[]

    res.status(200).json({
      members: members.map((m) => ({ email: m.email, role: m.role, status: m.status, createdAt: m.created_at })),
    })
  } catch (error) {
    console.error('[org-members] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 7: Implement `POST /api/org-members-approve`**

Create `backend/api/org-members-approve.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../lib/require-director.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-members-approve] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const callerEmail = await verifyEmail(idToken)
  if (!callerEmail) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { email?: unknown }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  const targetEmail = body.email.trim()

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`UPDATE org_members SET status = 'active' WHERE org_id = ${director.orgId} AND lower(email) = lower(${targetEmail})`,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[org-members-approve] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 8: Implement `POST /api/org-members-remove`**

Create `backend/api/org-members-remove.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../lib/require-director.js'
import { isLastActiveDirector } from '../lib/last-director-guard.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-members-remove] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const callerEmail = await verifyEmail(idToken)
  if (!callerEmail) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { email?: unknown }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  const targetEmail = body.email.trim()

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const targetRows = (await sql`
      SELECT role, status FROM org_members WHERE org_id = ${director.orgId} AND lower(email) = lower(${targetEmail})
    `) as { role: 'director' | 'member'; status: 'pending' | 'active' }[]
    const target = targetRows[0]
    if (!target) {
      res.status(404).json({ error: 'member not found' })
      return
    }

    if (target.role === 'director' && target.status === 'active') {
      const otherDirectorRows = (await sql`
        SELECT count(*)::int AS count FROM org_members
        WHERE org_id = ${director.orgId} AND role = 'director' AND status = 'active' AND lower(email) != lower(${targetEmail})
      `) as { count: number }[]
      if (isLastActiveDirector(target, otherDirectorRows[0]?.count ?? 0)) {
        res.status(400).json({ error: 'cannot remove the last director' })
        return
      }
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`DELETE FROM org_members WHERE org_id = ${director.orgId} AND lower(email) = lower(${targetEmail})`,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[org-members-remove] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 9: Implement `POST /api/org-members-add`**

Create `backend/api/org-members-add.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../lib/require-director.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-members-add] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const callerEmail = await verifyEmail(idToken)
  if (!callerEmail) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { email?: unknown }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  const targetEmail = body.email.trim().toLowerCase()

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`
        INSERT INTO org_members (org_id, email, role, status, invited_by)
        VALUES (${director.orgId}, ${targetEmail}, 'member', 'active', ${callerEmail})
        ON CONFLICT (org_id, email) DO UPDATE SET status = 'active'
      `,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[org-members-add] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 10: Implement `POST /api/org-members-set-role`**

Create `backend/api/org-members-set-role.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../lib/require-director.js'
import { isLastActiveDirector } from '../lib/last-director-guard.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-members-set-role] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const callerEmail = await verifyEmail(idToken)
  if (!callerEmail) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { email?: unknown; role?: unknown }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  if (body.role !== 'director' && body.role !== 'member') {
    res.status(400).json({ error: 'role must be "director" or "member"' })
    return
  }
  const targetEmail = body.email.trim()
  const newRole = body.role

  try {
    const director = await resolveDirectorContext(sql, callerEmail)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const targetRows = (await sql`
      SELECT role, status FROM org_members WHERE org_id = ${director.orgId} AND lower(email) = lower(${targetEmail})
    `) as { role: 'director' | 'member'; status: 'pending' | 'active' }[]
    const target = targetRows[0]
    if (!target) {
      res.status(404).json({ error: 'member not found' })
      return
    }

    if (newRole === 'member' && target.role === 'director') {
      const otherDirectorRows = (await sql`
        SELECT count(*)::int AS count FROM org_members
        WHERE org_id = ${director.orgId} AND role = 'director' AND status = 'active' AND lower(email) != lower(${targetEmail})
      `) as { count: number }[]
      if (isLastActiveDirector(target, otherDirectorRows[0]?.count ?? 0)) {
        res.status(400).json({ error: 'cannot demote the last director' })
        return
      }
    }

    // Promoting a still-pending member to director implies approving them
    // too -- there is no separate "approve" click required in this case.
    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`UPDATE org_members SET role = ${newRole}, status = 'active' WHERE org_id = ${director.orgId} AND lower(email) = lower(${targetEmail})`,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[org-members-set-role] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 11: Document the new endpoints**

Append to `backend/README.md`'s `## API` section:

```markdown
```
GET  /api/org-members                                    (director-only)
Authorization: Bearer <google-id-token>
200 -> { "members": [ { "email", "role", "status", "createdAt" } ] }
403 -> caller is not an active director

POST /api/org-members-approve   { "email": "..." }        (director-only) -> 204
POST /api/org-members-remove    { "email": "..." }        (director-only) -> 204 | 400 (last director)
POST /api/org-members-add       { "email": "..." }        (director-only) -> 204
POST /api/org-members-set-role  { "email": "...", "role": "director" | "member" }  (director-only) -> 204 | 400 (last director)
```
```

- [ ] **Step 12: Run the backend test suite and typecheck**

Run (from `backend/`): `pnpm test && pnpm typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 13: Commit**

```bash
git add backend/lib/require-director.ts backend/lib/last-director-guard.ts backend/lib/last-director-guard.test.ts backend/api/org-members.ts backend/api/org-members-approve.ts backend/api/org-members-remove.ts backend/api/org-members-add.ts backend/api/org-members-set-role.ts backend/README.md
git commit -m "feat: add director-only membership management endpoints with last-director guard"
```

---

### Task 4: Director-only org-prompt CRUD endpoints

**Files:**
- Modify: `backend/api/org-prompts.ts:32-83` (add `POST` handling to the existing `GET`-only handler)
- Create: `backend/api/org-prompts/[id].ts`

**Interfaces:**
- Consumes: `resolveDirectorContext` from `backend/lib/require-director.ts` (Task 3).
- Produces: `POST /api/org-prompts`, `PATCH /api/org-prompts/:id`, `DELETE /api/org-prompts/:id`, consumed by Task 8 (extension client). The `GET /api/org-prompts` response also gains an `id` field per prompt (Step 1 below), consumed by Task 12 (prompt management forms).

Vercel's file-based routing needs the dynamic `:id` segment as its own file (`api/org-prompts/[id].ts`) — the existing `api/org-prompts.ts` keeps handling the collection (`GET` list, now also `POST` create). The existing `GET` response never included each prompt's `id` (Phase 2C had no use for it, being read-only) — Step 1 below also adds it, since editing/deleting a specific prompt from the extension needs something to identify it by.

- [ ] **Step 1: Add `POST` (create) to the existing `org-prompts.ts` handler, and include `id` in the `GET` response**

In `backend/api/org-prompts.ts`, change the `PromptRow` interface from:

```ts
interface PromptRow {
  name: string
  prompt_text: string
  type: 'prompt' | 'skill'
}
```

to:

```ts
interface PromptRow {
  id: string
  name: string
  prompt_text: string
  type: 'prompt' | 'skill'
}
```

Change the existing `GET` query and response mapping from:

```ts
    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
      sql`SELECT name, prompt_text, type FROM prompts WHERE org_id = ${orgId}`,
    ])
    const prompts = results[1] as PromptRow[]

    res.status(200).json({
      org: { name: org.name },
      prompts: prompts.map((p) => ({ name: p.name, prompt_text: p.prompt_text, type: p.type })),
    })
```

to:

```ts
    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
      sql`SELECT id, name, prompt_text, type FROM prompts WHERE org_id = ${orgId}`,
    ])
    const prompts = results[1] as PromptRow[]

    res.status(200).json({
      org: { name: org.name },
      prompts: prompts.map((p) => ({ id: p.id, name: p.name, prompt_text: p.prompt_text, type: p.type })),
    })
```

In `backend/api/org-prompts.ts`, add this import alongside the existing ones:

```ts
import { resolveDirectorContext } from '../lib/require-director.js'
```

Replace the handler's method check (currently rejecting anything but `GET`):

```ts
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }
```

with:

```ts
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }
```

Then, immediately after the existing `email` verification block (after `if (!email) { res.status(401)...; return }`) and before the existing `try { const orgs = ... }` block, insert:

```ts
  if (req.method === 'POST') {
    const body = req.body as { name?: unknown; promptText?: unknown; type?: unknown }
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    if (typeof body.promptText !== 'string' || body.promptText.trim().length === 0) {
      res.status(400).json({ error: 'promptText is required' })
      return
    }
    if (body.type !== 'prompt' && body.type !== 'skill') {
      res.status(400).json({ error: 'type must be "prompt" or "skill"' })
      return
    }

    try {
      const director = await resolveDirectorContext(sql, email)
      if (!director) {
        res.status(403).json({ error: 'not a director' })
        return
      }

      await sql.transaction([
        sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
        sql`INSERT INTO prompts (org_id, name, prompt_text, type) VALUES (${director.orgId}, ${body.name.trim()}, ${body.promptText.trim()}, ${body.type})`,
      ])

      res.status(201).json({ ok: true })
    } catch (error) {
      console.error('[org-prompts] create failed', error)
      res.status(500).json({ error: 'internal error' })
    }
    return
  }
```

- [ ] **Step 2: Create the `[id]` route for edit/delete**

Create `backend/api/org-prompts/[id].ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../../lib/require-director.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-prompts/:id] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const promptId = req.query.id
  if (typeof promptId !== 'string') {
    res.status(400).json({ error: 'invalid prompt id' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyEmail(idToken)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  try {
    const director = await resolveDirectorContext(sql, email)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    if (req.method === 'DELETE') {
      await sql.transaction([
        sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
        sql`DELETE FROM prompts WHERE id = ${promptId} AND org_id = ${director.orgId}`,
      ])
      res.status(204).end()
      return
    }

    // PATCH
    const body = req.body as { name?: unknown; promptText?: unknown; type?: unknown }
    const updates: { name?: string; prompt_text?: string; type?: 'prompt' | 'skill' } = {}
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        res.status(400).json({ error: 'name must be a non-empty string' })
        return
      }
      updates.name = body.name.trim()
    }
    if (body.promptText !== undefined) {
      if (typeof body.promptText !== 'string' || body.promptText.trim().length === 0) {
        res.status(400).json({ error: 'promptText must be a non-empty string' })
        return
      }
      updates.prompt_text = body.promptText.trim()
    }
    if (body.type !== undefined) {
      if (body.type !== 'prompt' && body.type !== 'skill') {
        res.status(400).json({ error: 'type must be "prompt" or "skill"' })
        return
      }
      updates.type = body.type
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'no fields to update' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`
        UPDATE prompts SET
          name = COALESCE(${updates.name ?? null}, name),
          prompt_text = COALESCE(${updates.prompt_text ?? null}, prompt_text),
          type = COALESCE(${updates.type ?? null}, type)
        WHERE id = ${promptId} AND org_id = ${director.orgId}
      `,
    ])
    res.status(204).end()
  } catch (error) {
    console.error('[org-prompts/:id] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 3: Document the new endpoints**

Append to `backend/README.md`'s `## API` section:

```markdown
```
POST   /api/org-prompts        { "name", "promptText", "type" }         (director-only) -> 201
PATCH  /api/org-prompts/:id    { "name"?, "promptText"?, "type"? }        (director-only) -> 204
DELETE /api/org-prompts/:id                                               (director-only) -> 204
```
```

- [ ] **Step 4: Run the backend test suite and typecheck**

Run (from `backend/`): `pnpm test && pnpm typecheck`
Expected: all tests pass (no new pure logic in this task — the existing suite covers `resolve-org`/`resolve-session`/`last-director-guard`), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add backend/api/org-prompts.ts "backend/api/org-prompts/[id].ts" backend/README.md
git commit -m "feat: add director-only create/edit/delete endpoints for org prompts"
```

---

### Task 5: Usage-report + org-usage endpoints

**Files:**
- Create: `backend/api/usage-report.ts`
- Create: `backend/api/org-usage.ts`

**Interfaces:**
- Consumes: `resolveDirectorContext` from `backend/lib/require-director.ts` (Task 3).
- Produces: `POST /api/usage-report` and `GET /api/org-usage`, consumed by Task 9 (extension client).

Both handlers follow the same live-verification convention as the rest of this backend — no new pure logic in this task (percentage values pass straight through with only type validation).

- [ ] **Step 1: Implement `POST /api/usage-report`**

Create `backend/api/usage-report.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[usage-report] token verification failed', error)
    return null
  }
}

function isPercentOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && value >= 0 && value <= 100)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyEmail(idToken)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  const body = req.body as { sessionPercent?: unknown; weeklyPercent?: unknown; spendPercent?: unknown }
  if (
    !isPercentOrNull(body.sessionPercent) ||
    !isPercentOrNull(body.weeklyPercent) ||
    !isPercentOrNull(body.spendPercent)
  ) {
    res.status(400).json({ error: 'percent fields must be a number between 0 and 100, or null' })
    return
  }

  try {
    const memberRows = (await sql`
      SELECT org_id FROM org_members
      WHERE lower(email) = lower(${email}) AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `) as { org_id: string }[]
    const membership = memberRows[0]
    if (!membership) {
      res.status(403).json({ error: 'not an active organization member' })
      return
    }

    await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${membership.org_id}, true)`,
      sql`
        INSERT INTO usage_snapshots (org_id, email, session_percent, weekly_percent, spend_percent, updated_at)
        VALUES (${membership.org_id}, ${email}, ${body.sessionPercent}, ${body.weeklyPercent}, ${body.spendPercent}, now())
        ON CONFLICT (org_id, email) DO UPDATE SET
          session_percent = excluded.session_percent,
          weekly_percent = excluded.weekly_percent,
          spend_percent = excluded.spend_percent,
          updated_at = now()
      `,
    ])

    res.status(204).end()
  } catch (error) {
    console.error('[usage-report] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 2: Implement `GET /api/org-usage`**

Create `backend/api/org-usage.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveDirectorContext } from '../lib/require-director.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    if (!payload?.email_verified) return null
    return payload.email ?? null
  } catch (error) {
    console.error('[org-usage] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) {
    res.status(401).json({ error: 'missing token' })
    return
  }

  const email = await verifyEmail(idToken)
  if (!email) {
    res.status(401).json({ error: 'invalid token' })
    return
  }

  try {
    const director = await resolveDirectorContext(sql, email)
    if (!director) {
      res.status(403).json({ error: 'not a director' })
      return
    }

    const results = await sql.transaction([
      sql`SELECT set_config('app.current_org_id', ${director.orgId}, true)`,
      sql`SELECT email, session_percent, weekly_percent, spend_percent, updated_at FROM usage_snapshots WHERE org_id = ${director.orgId}`,
    ])
    const snapshots = results[1] as {
      email: string
      session_percent: number | null
      weekly_percent: number | null
      spend_percent: number | null
      updated_at: string
    }[]

    res.status(200).json({
      snapshots: snapshots.map((s) => ({
        email: s.email,
        sessionPercent: s.session_percent,
        weeklyPercent: s.weekly_percent,
        spendPercent: s.spend_percent,
        updatedAt: s.updated_at,
      })),
    })
  } catch (error) {
    console.error('[org-usage] database query failed', error)
    res.status(500).json({ error: 'internal error' })
  }
}
```

- [ ] **Step 3: Document the new endpoints**

Append to `backend/README.md`'s `## API` section:

```markdown
```
POST /api/usage-report
Authorization: Bearer <google-id-token>
Body: { "sessionPercent": number | null, "weeklyPercent": number | null, "spendPercent": number | null }
204 -> accepted
403 -> caller is not an active organization member

GET /api/org-usage   (director-only)
Authorization: Bearer <google-id-token>
200 -> { "snapshots": [ { "email", "sessionPercent", "weeklyPercent", "spendPercent", "updatedAt" } ] }
```
```

- [ ] **Step 4: Run the backend test suite and typecheck**

Run (from `backend/`): `pnpm test && pnpm typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add backend/api/usage-report.ts backend/api/org-usage.ts backend/README.md
git commit -m "feat: add usage-report and org-usage endpoints"
```

---

**Backend complete at this point.** Every endpoint below is implemented and (per this project's established convention) verified by deploying and calling it live — there is no local Vercel dev server in this project's workflow. Before starting Task 6, deploy the backend (`vercel deploy` from `backend/`, or push to the branch connected to the Vercel project) and apply the migration from Task 1 Step 5 against the real database, so Task 6 onward can be manually verified end-to-end against live endpoints as each extension task lands.

---

### Task 6: `src/shared/org-session.ts` client module

**Files:**
- Modify: `src/shared/org-prompts.ts:12` (export the existing `API_BASE_URL` constant for reuse)
- Create: `src/shared/org-session.ts`
- Create: `tests/shared/org-session.test.ts`

**Interfaces:**
- Consumes: `API_BASE_URL` from `src/shared/org-prompts.ts`.
- Produces: `OrgSessionState` type, `parseOrgSessionResponse(raw): OrgSessionState | null`, `fetchOrgSession(idToken): Promise<OrgSessionState | null>`, `OnboardingResult` type, `parseOnboardingResponse(raw): OnboardingResult | null`, `submitOrgOnboarding(idToken, orgName, initialMemberEmails): Promise<OnboardingResult | null>` — all consumed by Task 10 (`main.ts`).

Mirrors `src/shared/org-prompts.ts`'s existing defensive-parsing style: never throws, ignores anything unrecognized, returns `null` on a malformed response rather than guessing.

- [ ] **Step 1: Export the shared API base URL**

In `src/shared/org-prompts.ts`, change:

```ts
const API_BASE_URL = 'https://claude-extension-git-main-luxqees-projects.vercel.app'
```

to:

```ts
export const API_BASE_URL = 'https://claude-extension-git-main-luxqees-projects.vercel.app'
```

- [ ] **Step 2: Write the failing tests**

Create `tests/shared/org-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrgSessionResponse, parseOnboardingResponse } from '../../src/shared/org-session'

describe('parseOrgSessionResponse', () => {
  it('parses an active state with org and role', () => {
    const raw = { state: 'active', org: { id: 'org-1', name: 'Acme' }, role: 'director' }
    expect(parseOrgSessionResponse(raw)).toEqual({
      state: 'active',
      org: { id: 'org-1', name: 'Acme' },
      role: 'director',
    })
  })

  it('parses a pending state with org, no role', () => {
    const raw = { state: 'pending', org: { id: 'org-1', name: 'Acme' } }
    expect(parseOrgSessionResponse(raw)).toEqual({ state: 'pending', org: { id: 'org-1', name: 'Acme' } })
  })

  it('parses a needs_onboarding state', () => {
    expect(parseOrgSessionResponse({ state: 'needs_onboarding' })).toEqual({ state: 'needs_onboarding' })
  })

  it('returns null for an unrecognized state value', () => {
    expect(parseOrgSessionResponse({ state: 'bogus' })).toBeNull()
  })

  it('returns null when active is missing org', () => {
    expect(parseOrgSessionResponse({ state: 'active', role: 'director' })).toBeNull()
  })

  it('returns null when active has an unrecognized role', () => {
    expect(parseOrgSessionResponse({ state: 'active', org: { id: 'x', name: 'Y' }, role: 'bogus' })).toBeNull()
  })

  it('returns null for non-object input, without throwing', () => {
    expect(parseOrgSessionResponse(null)).toBeNull()
    expect(parseOrgSessionResponse(undefined)).toBeNull()
    expect(parseOrgSessionResponse('nope')).toBeNull()
  })
})

describe('parseOnboardingResponse', () => {
  it('parses a created outcome with role', () => {
    const raw = { outcome: 'created', org: { id: 'org-1', name: 'Acme' }, role: 'director' }
    expect(parseOnboardingResponse(raw)).toEqual({
      outcome: 'created',
      org: { id: 'org-1', name: 'Acme' },
      role: 'director',
    })
  })

  it('parses a joined_existing outcome without role', () => {
    const raw = { outcome: 'joined_existing', org: { id: 'org-1', name: 'Acme' } }
    expect(parseOnboardingResponse(raw)).toEqual({ outcome: 'joined_existing', org: { id: 'org-1', name: 'Acme' } })
  })

  it('returns null for an unrecognized outcome', () => {
    expect(parseOnboardingResponse({ outcome: 'bogus', org: { id: 'x', name: 'Y' } })).toBeNull()
  })

  it('returns null for non-object input, without throwing', () => {
    expect(parseOnboardingResponse(null)).toBeNull()
    expect(parseOnboardingResponse('nope')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- org-session.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/org-session'`.

- [ ] **Step 4: Implement the module**

Create `src/shared/org-session.ts`:

```ts
import { API_BASE_URL } from './org-prompts'

export interface OrgSummary {
  id: string
  name: string
}

export type OrgSessionState =
  | { state: 'active'; org: OrgSummary; role: 'director' | 'member' }
  | { state: 'pending'; org: OrgSummary }
  | { state: 'needs_onboarding' }

export interface OnboardingResult {
  outcome: 'created' | 'joined_existing'
  org: OrgSummary
  role?: 'director'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseOrgSummary(value: unknown): OrgSummary | null {
  if (!isRecord(value)) return null
  const id = value.id
  const name = value.name
  if (typeof id !== 'string' || typeof name !== 'string') return null
  return { id, name }
}

export function parseOrgSessionResponse(raw: unknown): OrgSessionState | null {
  if (!isRecord(raw)) return null
  const state = raw.state

  if (state === 'needs_onboarding') return { state: 'needs_onboarding' }

  if (state === 'pending') {
    const org = parseOrgSummary(raw.org)
    return org ? { state: 'pending', org } : null
  }

  if (state === 'active') {
    const org = parseOrgSummary(raw.org)
    const role = raw.role
    if (!org || (role !== 'director' && role !== 'member')) return null
    return { state: 'active', org, role }
  }

  return null
}

export function parseOnboardingResponse(raw: unknown): OnboardingResult | null {
  if (!isRecord(raw)) return null
  const outcome = raw.outcome
  const org = parseOrgSummary(raw.org)
  if (!org) return null

  if (outcome === 'joined_existing') return { outcome: 'joined_existing', org }

  if (outcome === 'created') {
    const role = raw.role
    if (role !== 'director') return null
    return { outcome: 'created', org, role }
  }

  return null
}

export async function fetchOrgSession(idToken: string): Promise<OrgSessionState | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org session', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-session endpoint returned status', response.status)
    return null
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-session response was not valid JSON', error)
    return null
  }
  return parseOrgSessionResponse(body)
}

export async function submitOrgOnboarding(
  idToken: string,
  orgName: string,
  initialMemberEmails: string[],
): Promise<OnboardingResult | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-onboarding`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgName, initialMemberEmails }),
    })
  } catch (error) {
    console.error('[Claude Tools] failed to submit org onboarding', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-onboarding endpoint returned status', response.status)
    return null
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-onboarding response was not valid JSON', error)
    return null
  }
  return parseOnboardingResponse(body)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- org-session.test.ts`
Expected: PASS, all 11 tests green.

- [ ] **Step 6: Run the full suite and build, then commit**

Run: `pnpm test && pnpm run build`
Expected: all tests pass, build succeeds.

```bash
git add src/shared/org-prompts.ts src/shared/org-session.ts tests/shared/org-session.test.ts
git commit -m "feat: add org-session and org-onboarding client module"
```

---

### Task 7: `src/shared/org-members.ts` client module

**Files:**
- Create: `src/shared/org-members.ts`
- Create: `tests/shared/org-members.test.ts`

**Interfaces:**
- Consumes: `API_BASE_URL` from `src/shared/org-prompts.ts` (Task 6).
- Produces: `OrgMember` type, `parseOrgMembersResponse(raw): OrgMember[]`, `fetchOrgMembers(idToken): Promise<OrgMember[] | null>`, `approveOrgMember(idToken, email): Promise<boolean>`, `removeOrgMember(idToken, email): Promise<{ ok: true } | { ok: false; error: string }>`, `addOrgMember(idToken, email): Promise<boolean>`, `setOrgMemberRole(idToken, email, role): Promise<{ ok: true } | { ok: false; error: string }>` — all consumed by Task 11 (Manage Organisation roster view).

`removeOrgMember`/`setOrgMemberRole` surface the last-director-guard's 400 error message to the caller rather than collapsing it to a boolean, since the UI needs to show *why* the action was refused.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/org-members.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrgMembersResponse } from '../../src/shared/org-members'

describe('parseOrgMembersResponse', () => {
  it('parses a list of members', () => {
    const raw = {
      members: [
        { email: 'alice@acme.com', role: 'director', status: 'active', createdAt: '2026-08-19T00:00:00Z' },
        { email: 'bob@acme.com', role: 'member', status: 'pending', createdAt: '2026-08-19T01:00:00Z' },
      ],
    }
    expect(parseOrgMembersResponse(raw)).toEqual([
      { email: 'alice@acme.com', role: 'director', status: 'active', createdAt: '2026-08-19T00:00:00Z' },
      { email: 'bob@acme.com', role: 'member', status: 'pending', createdAt: '2026-08-19T01:00:00Z' },
    ])
  })

  it('skips a malformed entry instead of throwing', () => {
    const raw = { members: [{ email: 'alice@acme.com', role: 'bogus', status: 'active', createdAt: 'x' }] }
    expect(parseOrgMembersResponse(raw)).toEqual([])
  })

  it('returns an empty array when members is missing', () => {
    expect(parseOrgMembersResponse({})).toEqual([])
  })

  it('returns an empty array for non-object input, without throwing', () => {
    expect(parseOrgMembersResponse(null)).toEqual([])
    expect(parseOrgMembersResponse('nope')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- org-members.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/org-members'`.

- [ ] **Step 3: Implement the module**

Create `src/shared/org-members.ts`:

```ts
import { API_BASE_URL } from './org-prompts'

export interface OrgMember {
  email: string
  role: 'director' | 'member'
  status: 'pending' | 'active'
  createdAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMember(entry: unknown): OrgMember | null {
  if (!isRecord(entry)) return null
  const email = entry.email
  const role = entry.role
  const status = entry.status
  const createdAt = entry.createdAt
  if (typeof email !== 'string' || typeof createdAt !== 'string') return null
  if (role !== 'director' && role !== 'member') return null
  if (status !== 'pending' && status !== 'active') return null
  return { email, role, status, createdAt }
}

export function parseOrgMembersResponse(raw: unknown): OrgMember[] {
  if (!isRecord(raw) || !Array.isArray(raw.members)) return []
  const members: OrgMember[] = []
  for (const entry of raw.members) {
    const member = parseMember(entry)
    if (member) members.push(member)
  }
  return members
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // fall through to the generic message below
  }
  return 'Something went wrong. Check the console for details.'
}

export async function fetchOrgMembers(idToken: string): Promise<OrgMember[] | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-members`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org members', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-members endpoint returned status', response.status)
    return null
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-members response was not valid JSON', error)
    return null
  }
  return parseOrgMembersResponse(body)
}

export async function approveOrgMember(idToken: string, email: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-members-approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to approve org member', error)
    return false
  }
}

export async function removeOrgMember(
  idToken: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-members-remove`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.ok) return { ok: true }
    return { ok: false, error: await parseErrorMessage(response) }
  } catch (error) {
    console.error('[Claude Tools] failed to remove org member', error)
    return { ok: false, error: 'Something went wrong. Check the console for details.' }
  }
}

export async function addOrgMember(idToken: string, email: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-members-add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to add org member', error)
    return false
  }
}

export async function setOrgMemberRole(
  idToken: string,
  email: string,
  role: 'director' | 'member',
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-members-set-role`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    if (response.ok) return { ok: true }
    return { ok: false, error: await parseErrorMessage(response) }
  } catch (error) {
    console.error('[Claude Tools] failed to change org member role', error)
    return { ok: false, error: 'Something went wrong. Check the console for details.' }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- org-members.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Run the full suite and build, then commit**

Run: `pnpm test && pnpm run build`
Expected: all tests pass, build succeeds.

```bash
git add src/shared/org-members.ts tests/shared/org-members.test.ts
git commit -m "feat: add org-members client module for director membership actions"
```

---

### Task 8: Extend `org-prompts.ts` with director create/edit/delete calls

**Files:**
- Modify: `src/shared/org-prompts.ts`
- Modify: `tests/shared/org-prompts.test.ts`

**Interfaces:**
- Consumes: the backend's `GET /api/org-prompts` response now including `id` per prompt (Task 4, Step 1).
- Produces: `OrgPrompt` gains an `id: string` field. `createOrgPrompt(idToken, input): Promise<boolean>`, `updateOrgPrompt(idToken, id, updates): Promise<boolean>`, `deleteOrgPrompt(idToken, id): Promise<boolean>` — all consumed by Task 12 (prompt management forms).

- [ ] **Step 1: Write the failing test for parsing `id`**

In `tests/shared/org-prompts.test.ts`, replace the first test (`'parses a matched org with prompts'`) with:

```ts
  it('parses a matched org with prompts, including each prompt id', () => {
    const raw = {
      org: { name: 'Acme' },
      prompts: [
        { id: 'p1', name: 'Summarize', prompt_text: 'Summarize this.', type: 'prompt' },
        { id: 'p2', name: 'Doc Summary', prompt_text: '/doc-summary', type: 'skill' },
      ],
    }
    expect(parseOrgPromptsResponse(raw)).toEqual({
      orgName: 'Acme',
      prompts: [
        { id: 'p1', name: 'Summarize', promptText: 'Summarize this.', type: 'prompt' },
        { id: 'p2', name: 'Doc Summary', promptText: '/doc-summary', type: 'skill' },
      ],
    })
  })
```

Update the `'skips a prompt entry missing required fields instead of throwing'` test's `raw` value from `{ name: 'Bad' }` to `{ id: 'p1', name: 'Bad' }` (still missing `promptText`/`type`, so it still exercises the same skip path — this just keeps the fixture realistic now that `id` is expected on every entry).

Add one more test, after the `'skips a prompt entry with an unrecognized type'` test:

```ts
  it('skips a prompt entry missing an id', () => {
    const raw = { org: { name: 'Acme' }, prompts: [{ name: 'X', prompt_text: 'y', type: 'prompt' }] }
    expect(parseOrgPromptsResponse(raw).prompts).toEqual([])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- org-prompts.test.ts`
Expected: FAIL — the updated assertions expect an `id` field the current implementation doesn't produce.

- [ ] **Step 3: Add `id` to the `OrgPrompt` type and parser**

In `src/shared/org-prompts.ts`, change the `OrgPrompt` interface from:

```ts
export interface OrgPrompt {
  name: string
  promptText: string
  type: 'prompt' | 'skill'
}
```

to:

```ts
export interface OrgPrompt {
  id: string
  name: string
  promptText: string
  type: 'prompt' | 'skill'
}
```

Change the `parsePrompt` function from:

```ts
function parsePrompt(entry: unknown): OrgPrompt | null {
  if (!isRecord(entry)) return null
  const name = entry.name
  const promptText = entry.prompt_text
  const type = entry.type
  if (typeof name !== 'string' || typeof promptText !== 'string') return null
  if (type !== 'prompt' && type !== 'skill') return null
  return { name, promptText, type }
}
```

to:

```ts
function parsePrompt(entry: unknown): OrgPrompt | null {
  if (!isRecord(entry)) return null
  const id = entry.id
  const name = entry.name
  const promptText = entry.prompt_text
  const type = entry.type
  if (typeof id !== 'string' || typeof name !== 'string' || typeof promptText !== 'string') return null
  if (type !== 'prompt' && type !== 'skill') return null
  return { id, name, promptText, type }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- org-prompts.test.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Add the create/edit/delete functions**

In `src/shared/org-prompts.ts`, add after the existing `loadOrgPrompts` function:

```ts
export interface CreateOrgPromptInput {
  name: string
  promptText: string
  type: 'prompt' | 'skill'
}

export async function createOrgPrompt(idToken: string, input: CreateOrgPromptInput): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-prompts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to create org prompt', error)
    return false
  }
}

export interface UpdateOrgPromptInput {
  name?: string
  promptText?: string
  type?: 'prompt' | 'skill'
}

export async function updateOrgPrompt(idToken: string, id: string, input: UpdateOrgPromptInput): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-prompts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to update org prompt', error)
    return false
  }
}

export async function deleteOrgPrompt(idToken: string, id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/org-prompts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to delete org prompt', error)
    return false
  }
}
```

- [ ] **Step 6: Run the full suite and build, then commit**

Run: `pnpm test && pnpm run build`
Expected: all tests pass (including the updated `org-prompts.test.ts` suite from Steps 1-4), build succeeds.

```bash
git add src/shared/org-prompts.ts tests/shared/org-prompts.test.ts
git commit -m "feat: add prompt id parsing and director create/edit/delete calls to org-prompts client"
```

---

### Task 9: Usage reporting — message bridge + client module

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `src/content/content-script.ts`
- Create: `src/shared/usage-report.ts`
- Create: `tests/shared/usage-report.test.ts`

**Interfaces:**
- Consumes: `UsageSnapshot`/`UsageMeter` from `src/shared/usage.ts` (existing), `fetchUsage` from `src/content/usage-client.ts` (existing), `API_BASE_URL` from `src/shared/org-prompts.ts` (Task 6).
- Produces: `GetUsageRequest`/`GetUsageResponse` message types, consumed by Task 13 (`main.ts`). `usageSnapshotToReportBody(snapshot): UsageReportBody`, `reportUsage(idToken, snapshot): Promise<boolean>` — consumed by Task 13.

The sidepanel has no access to claude.ai's usage data today — only the content script does (`src/content/usage-client.ts`, already used by the Phase 1 usage widget injected into the claude.ai page). This task adds a message round-trip, the same pattern `INSERT_PROMPT` already uses, so the sidepanel can ask the content script for the current usage snapshot before reporting it to the backend.

- [ ] **Step 1: Add the new message types**

In `src/shared/messages.ts`, add after the existing `InsertPromptResponse` type:

```ts
export interface GetUsageRequest {
  type: 'GET_USAGE'
}

export type GetUsageResponse =
  | { ok: true; usage: { meters: { label: string; percent: number; severity: string; resetsAt: string | null }[] } }
  | { ok: false }
```

- [ ] **Step 2: Wire the content script to answer it**

In `src/content/content-script.ts`, add this import alongside the existing ones:

```ts
import { fetchUsage } from './usage-client'
import type { GetUsageRequest, InsertPromptRequest } from '../shared/messages'
```

(This replaces the existing `import type { InsertPromptRequest } from '../shared/messages'` line — combine both type imports into the one line above.)

Add a second listener below the existing `chrome.runtime.onMessage.addListener` block (content scripts may register more than one listener; each independently ignores messages it doesn't recognize, matching the existing listener's own `if (... !== 'INSERT_PROMPT') return undefined` guard):

```ts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message as GetUsageRequest).type !== 'GET_USAGE') return undefined
  fetchUsage()
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error('[Claude Tools] unexpected error during fetchUsage', error)
      sendResponse({ ok: false })
    })
  return true
})
```

- [ ] **Step 3: Write the failing tests for the pure mapping function**

Create `tests/shared/usage-report.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { usageSnapshotToReportBody } from '../../src/shared/usage-report'

describe('usageSnapshotToReportBody', () => {
  it('maps Session, Weekly, and Extra usage meters to their named fields', () => {
    const snapshot = {
      meters: [
        { label: 'Session', percent: 12, severity: 'normal', resetsAt: null },
        { label: 'Weekly', percent: 25, severity: 'normal', resetsAt: null },
        { label: 'Extra usage', percent: 73, severity: 'normal', resetsAt: null },
      ],
    }
    expect(usageSnapshotToReportBody(snapshot)).toEqual({
      sessionPercent: 12,
      weeklyPercent: 25,
      spendPercent: 73,
    })
  })

  it('reports null for a meter that is absent', () => {
    const snapshot = { meters: [{ label: 'Session', percent: 12, severity: 'normal', resetsAt: null }] }
    expect(usageSnapshotToReportBody(snapshot)).toEqual({
      sessionPercent: 12,
      weeklyPercent: null,
      spendPercent: null,
    })
  })

  it('returns all nulls for an empty meters array', () => {
    expect(usageSnapshotToReportBody({ meters: [] })).toEqual({
      sessionPercent: null,
      weeklyPercent: null,
      spendPercent: null,
    })
  })

  it('ignores an unrecognized meter label', () => {
    const snapshot = { meters: [{ label: 'Mystery', percent: 50, severity: 'normal', resetsAt: null }] }
    expect(usageSnapshotToReportBody(snapshot)).toEqual({
      sessionPercent: null,
      weeklyPercent: null,
      spendPercent: null,
    })
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test -- usage-report.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/usage-report'`.

- [ ] **Step 5: Implement the module**

Create `src/shared/usage-report.ts`:

```ts
import { API_BASE_URL } from './org-prompts'
import type { UsageSnapshot } from './usage'

export interface UsageReportBody {
  sessionPercent: number | null
  weeklyPercent: number | null
  spendPercent: number | null
}

export function usageSnapshotToReportBody(snapshot: UsageSnapshot): UsageReportBody {
  const session = snapshot.meters.find((m) => m.label === 'Session')
  const weekly = snapshot.meters.find((m) => m.label === 'Weekly')
  const spend = snapshot.meters.find((m) => m.label === 'Extra usage')
  return {
    sessionPercent: session?.percent ?? null,
    weeklyPercent: weekly?.percent ?? null,
    spendPercent: spend?.percent ?? null,
  }
}

export async function reportUsage(idToken: string, snapshot: UsageSnapshot): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/usage-report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(usageSnapshotToReportBody(snapshot)),
    })
    return response.ok
  } catch (error) {
    console.error('[Claude Tools] failed to report usage', error)
    return false
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test -- usage-report.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 7: Run the full suite and build, then commit**

Run: `pnpm test && pnpm run build`
Expected: all tests pass, build succeeds.

```bash
git add src/shared/messages.ts src/content/content-script.ts src/shared/usage-report.ts tests/shared/usage-report.test.ts
git commit -m "feat: add GET_USAGE message bridge and usage-report client module"
```

---

### Task 10: Onboarding view + org-session-aware sign-in flow

**Files:**
- Create: `src/sidepanel/OrgOnboarding.ts`
- Modify: `src/sidepanel/render.ts`
- Modify: `src/sidepanel/style.css`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/SettingsPanel.ts`

**Interfaces:**
- Consumes: `OrgSessionState`, `fetchOrgSession`, `submitOrgOnboarding` from `src/shared/org-session.ts` (Task 6).
- Produces: `renderOrgOnboarding(context): HTMLElement`. `View` gains a `{ mode: 'org-onboarding' }` member. `RenderContext` gains `onOnboardingSubmit`/`onOnboardingCancel`. `renderApp` gains an `orgSession: OrgSessionState | null` parameter, inserted after `session`, before `teamPrompts` — Tasks 11-13 depend on this exact position for the Manage Organisation view's own further parameter. A module-level `orgSession` variable and a `resolveOrgSession(root)` function in `main.ts` (replacing the Phase 2C `refreshTeamPrompts` function), consumed by Task 14 (usage-reporting timer).

This is one task, not split further, because a view with no real wiring and wiring with no view are each individually unbuildable — this is the smallest slice that leaves `pnpm run build` clean end to end (per this plan's Global Constraints).

This task is manual-verification-only (DOM rendering, no test infrastructure for this exists or should be added — matching every other sidepanel UI task in this project).

- [ ] **Step 1: Write the onboarding view component**

Create `src/sidepanel/OrgOnboarding.ts`:

```ts
export interface OrgOnboardingContext {
  onSubmit: (data: { orgName: string; initialMemberEmails: string[] }) => void
  onCancel: () => void
}

export function renderOrgOnboarding(context: OrgOnboardingContext): HTMLElement {
  const container = document.createElement('div')
  container.className = 'org-onboarding'

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Set up your organisation'
  container.appendChild(heading)

  const hint = document.createElement('p')
  hint.className = 'settings-hint'
  hint.textContent = 'No organisation exists yet for your email. Name yours to become its director.'
  container.appendChild(hint)

  const form = document.createElement('form')
  form.className = 'edit-form'

  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Organisation name'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.required = true
  nameLabel.appendChild(nameInput)
  form.appendChild(nameLabel)

  const emailsLabel = document.createElement('label')
  const emailsLabelText = document.createElement('span')
  emailsLabelText.textContent = 'Add teammates now (optional)'
  emailsLabel.appendChild(emailsLabelText)
  const emailsInput = document.createElement('textarea')
  emailsInput.rows = 4
  emailsInput.placeholder = 'One email per line'
  emailsLabel.appendChild(emailsInput)
  form.appendChild(emailsLabel)

  const actions = document.createElement('div')
  actions.className = 'edit-form-actions'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.textContent = 'Cancel'
  cancelButton.addEventListener('click', context.onCancel)
  actions.appendChild(cancelButton)

  const submitButton = document.createElement('button')
  submitButton.type = 'submit'
  submitButton.textContent = 'Create organisation'
  actions.appendChild(submitButton)

  form.appendChild(actions)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const orgName = nameInput.value.trim()
    if (!orgName) return
    const initialMemberEmails = emailsInput.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    context.onSubmit({ orgName, initialMemberEmails })
  })

  container.appendChild(form)
  return container
}
```

- [ ] **Step 2: Add CSS for the onboarding view**

In `src/sidepanel/style.css`, add after the existing `.settings-back-button { ... }` rule:

```css
.org-onboarding {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

- [ ] **Step 3: Wire the new view mode and org-session state into `render.ts`**

In `src/sidepanel/render.ts`, add to the imports:

```ts
import { renderOrgOnboarding } from './OrgOnboarding'
import type { OrgSessionState } from '../shared/org-session'
```

Change the `View` type from:

```ts
export type View = { mode: 'list' } | { mode: 'form'; button: Button | null } | { mode: 'settings' }
```

to:

```ts
export type View =
  | { mode: 'list' }
  | { mode: 'form'; button: Button | null }
  | { mode: 'settings' }
  | { mode: 'org-onboarding' }
```

Add two new callbacks to `RenderContext`, alongside `onRunTeamPrompt`:

```ts
  onOnboardingSubmit: (data: { orgName: string; initialMemberEmails: string[] }) => void
  onOnboardingCancel: () => void
```

Change the `renderApp` signature (currently `root, buttons, view, runState, settingsState, session, teamPrompts, context`) to insert `orgSession` after `session`:

```ts
export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  session: { email: string } | null,
  orgSession: OrgSessionState | null,
  teamPrompts: OrgPromptsResult,
  context: RenderContext,
): void {
```

Add a new branch, immediately after the existing `if (view.mode === 'settings') { ...; return }` block:

```ts
  if (view.mode === 'org-onboarding') {
    root.appendChild(
      renderOrgOnboarding({ onSubmit: context.onOnboardingSubmit, onCancel: context.onOnboardingCancel }),
    )
    return
  }
```

Replace the existing Team-section block at the end of the function:

```ts
  if (session && teamPrompts.prompts.length > 0) {
    root.appendChild(
      renderTeamSection(teamPrompts.orgName ?? 'Team', teamPrompts.prompts, context.onRunTeamPrompt),
    )
  }
```

with:

```ts
  if (orgSession?.state === 'pending') {
    const banner = document.createElement('p')
    banner.className = 'org-pending-banner'
    banner.textContent = "You're signed in. Waiting for a director to approve you."
    root.appendChild(banner)
  } else if (orgSession?.state === 'active' && teamPrompts.prompts.length > 0) {
    root.appendChild(
      renderTeamSection(teamPrompts.orgName ?? 'Team', teamPrompts.prompts, context.onRunTeamPrompt),
    )
  }
```

- [ ] **Step 4: Add CSS for the pending banner**

In `src/sidepanel/style.css`, add after the new `.org-onboarding { ... }` rule from Step 2:

```css
.org-pending-banner {
  margin: 14px 0 0;
  padding: 10px 12px;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-muted);
}
```

- [ ] **Step 5: Update the Settings panel's sign-in copy**

In `src/sidepanel/SettingsPanel.ts`, change the sign-in button's text from:

```ts
    signInButton.textContent = 'Sign in with Google'
```

to:

```ts
    signInButton.textContent = 'Sign in with your organisation'
```

Change the hint text below it from:

```ts
    signInHint.textContent = "See your company's shared prompts, if your organization has set them up."
```

to:

```ts
    signInHint.textContent = 'Uses your work Google account to find or set up your organisation.'
```

- [ ] **Step 6: Rewrite the sign-in flow in `main.ts`**

In `src/sidepanel/main.ts`, update the imports — change:

```ts
import {
  loadOrgPrompts,
  clearCachedOrgPrompts,
  type OrgPrompt,
  type OrgPromptsResult,
} from '../shared/org-prompts'
```

to:

```ts
import {
  loadOrgPrompts,
  clearCachedOrgPrompts,
  type OrgPrompt,
  type OrgPromptsResult,
} from '../shared/org-prompts'
import { fetchOrgSession, submitOrgOnboarding, type OrgSessionState } from '../shared/org-session'
```

Add a module-level variable alongside the existing `let teamPrompts`:

```ts
let orgSession: OrgSessionState | null = null
```

Replace the entire `refreshTeamPrompts` function with:

```ts
async function resolveOrgSession(root: HTMLElement): Promise<void> {
  const startedForSession = session
  const idToken = await authAdapter.getValidIdToken()
  if (session !== startedForSession) return
  if (!idToken) {
    const stillSignedIn = await authAdapter.getCurrentSession()
    if (session !== startedForSession) return
    if (session && !stillSignedIn) {
      session = null
      await clearCachedOrgPrompts()
      announce('Please sign in again to see your organisation.')
    }
    orgSession = null
    teamPrompts = { orgName: null, prompts: [] }
    if (view.mode === 'list') await refresh(root)
    return
  }

  const resolution = await fetchOrgSession(idToken)
  if (session !== startedForSession) return
  orgSession = resolution

  if (resolution?.state === 'needs_onboarding') {
    view = { mode: 'org-onboarding' }
    await refresh(root)
    return
  }

  if (resolution?.state === 'active') {
    const result = await loadOrgPrompts(idToken)
    if (session !== startedForSession) return
    teamPrompts = result
  } else {
    teamPrompts = { orgName: null, prompts: [] }
  }
  if (view.mode === 'list') await refresh(root)
}
```

Update the call to `renderApp` inside `refresh` to pass `orgSession` after `session`:

```ts
    renderApp(root, buttons, view, runState, settingsState, session, orgSession, teamPrompts, {
```

(This is the same call already at the top of `refresh` — only the argument list changes, the object literal that follows is unchanged.)

Replace the existing `onSignIn` handler with:

```ts
      onSignIn: async () => {
        const result = await authAdapter.signIn()
        if (result) {
          session = { email: result.email }
          announce(`Signed in as ${result.email}`)
          await refresh(root)
          void resolveOrgSession(root)
        } else {
          announce('Sign in was not completed.')
          await refresh(root)
        }
      },
```

Replace the existing `onSignOut` handler with:

```ts
      onSignOut: async () => {
        await authAdapter.signOut()
        await clearCachedOrgPrompts()
        session = null
        orgSession = null
        teamPrompts = { orgName: null, prompts: [] }
        if (view.mode === 'org-onboarding') view = { mode: 'list' }
        await refresh(root)
      },
```

Add two new handlers to the object passed to `renderApp`, alongside `onSignIn`/`onSignOut`:

```ts
      onOnboardingSubmit: async (data: { orgName: string; initialMemberEmails: string[] }) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) {
          announce('Please sign in again to set up your organisation.')
          view = { mode: 'list' }
          await refresh(root)
          return
        }
        const result = await submitOrgOnboarding(idToken, data.orgName, data.initialMemberEmails)
        if (!result) {
          announce('Something went wrong setting up your organisation. Check the console for details.')
          return
        }
        view = { mode: 'list' }
        announce(result.outcome === 'created' ? `${result.org.name} created.` : `Joined ${result.org.name}.`)
        await refresh(root)
        void resolveOrgSession(root)
      },
      onOnboardingCancel: async () => {
        await authAdapter.signOut()
        await clearCachedOrgPrompts()
        session = null
        orgSession = null
        teamPrompts = { orgName: null, prompts: [] }
        view = { mode: 'list' }
        await refresh(root)
      },
```

Update the `start()` function's call to the renamed resolution function — change:

```ts
async function start(): Promise<void> {
  session = await authAdapter.getCurrentSession()
  await refresh(root)
  if (session) void refreshTeamPrompts(root)
}
```

to:

```ts
async function start(): Promise<void> {
  session = await authAdapter.getCurrentSession()
  await refresh(root)
  if (session) void resolveOrgSession(root)
}
```

- [ ] **Step 7: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: existing tests pass; build succeeds with no type errors (the `renderApp` signature change must match its one call site, updated in Step 6).

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/OrgOnboarding.ts src/sidepanel/render.ts src/sidepanel/style.css src/sidepanel/main.ts src/sidepanel/SettingsPanel.ts
git commit -m "feat: add organisation onboarding view and org-session-aware sign-in flow"
```

---

### Task 11: Manage Organisation view — member roster

**Files:**
- Create: `src/sidepanel/ManageOrganisation.ts`
- Modify: `src/sidepanel/render.ts`
- Modify: `src/sidepanel/SettingsPanel.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/style.css`

**Interfaces:**
- Consumes: `OrgMember`, `fetchOrgMembers`, `approveOrgMember`, `removeOrgMember`, `addOrgMember`, `setOrgMemberRole` from `src/shared/org-members.ts` (Task 7).
- Produces: `renderManageOrganisation(context): HTMLElement`, `ManageOrgState` type. `View` gains `{ mode: 'manage-org' }`. `renderApp` gains a `manageOrgState: ManageOrgState` parameter, inserted after `teamPrompts`, before `context` — Task 12 and Task 13 depend on this exact position for their own further fields added to the same state object (not new positional parameters — see those tasks). Module-level `orgMembers`/`manageOrgAddError` state and a `refreshOrgMembers` function in `main.ts`, consumed by Task 12.

This is one task, not split further, for the same reason as Task 10: the roster component, its view routing, and its data-fetching wiring only form a working, buildable whole together.

- [ ] **Step 1: Write the roster view component**

Create `src/sidepanel/ManageOrganisation.ts`:

```ts
import type { OrgMember } from '../shared/org-members'

export interface ManageOrgState {
  members: OrgMember[]
  addError: string | null
}

export interface ManageOrganisationContext {
  onApprove: (email: string) => void
  onRemove: (email: string) => void
  onPromote: (email: string) => void
  onDemote: (email: string) => void
  onAdd: (email: string) => void
  onBack: () => void
}

export function renderManageOrganisation(state: ManageOrgState, context: ManageOrganisationContext): HTMLElement {
  const container = document.createElement('div')
  container.className = 'manage-org'

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Manage Organisation'
  container.appendChild(heading)

  const rosterHeading = document.createElement('h3')
  rosterHeading.className = 'team-section-heading'
  rosterHeading.textContent = 'Members'
  container.appendChild(rosterHeading)

  const list = document.createElement('ul')
  list.className = 'roster-list'
  state.members.forEach((member) => {
    const item = document.createElement('li')
    item.className = 'roster-row'

    const email = document.createElement('span')
    email.className = 'roster-row-email'
    email.textContent = member.email
    item.appendChild(email)

    const status = document.createElement('span')
    status.className = 'roster-row-status'
    status.textContent =
      member.status === 'pending' ? 'Pending' : member.role === 'director' ? 'Director' : 'Member'
    item.appendChild(status)

    const actions = document.createElement('div')
    actions.className = 'roster-row-actions'

    if (member.status === 'pending') {
      const approveButton = document.createElement('button')
      approveButton.type = 'button'
      approveButton.className = 'settings-action-button'
      approveButton.textContent = 'Approve'
      approveButton.addEventListener('click', () => context.onApprove(member.email))
      actions.appendChild(approveButton)
    } else if (member.role === 'member') {
      const promoteButton = document.createElement('button')
      promoteButton.type = 'button'
      promoteButton.className = 'settings-action-button'
      promoteButton.textContent = 'Make director'
      promoteButton.addEventListener('click', () => context.onPromote(member.email))
      actions.appendChild(promoteButton)
    } else {
      const demoteButton = document.createElement('button')
      demoteButton.type = 'button'
      demoteButton.className = 'settings-action-button'
      demoteButton.textContent = 'Remove director role'
      demoteButton.addEventListener('click', () => context.onDemote(member.email))
      actions.appendChild(demoteButton)
    }

    const removeButton = document.createElement('button')
    removeButton.type = 'button'
    removeButton.className = 'icon-button icon-button-danger'
    removeButton.textContent = 'Remove'
    removeButton.addEventListener('click', () => context.onRemove(member.email))
    actions.appendChild(removeButton)

    item.appendChild(actions)
    list.appendChild(item)
  })
  container.appendChild(list)

  const addSection = document.createElement('div')
  addSection.className = 'settings-section'
  const addForm = document.createElement('form')
  addForm.className = 'roster-add-form'
  const addInput = document.createElement('input')
  addInput.type = 'email'
  addInput.required = true
  addInput.placeholder = 'teammate@company.com'
  addForm.appendChild(addInput)
  const addButton = document.createElement('button')
  addButton.type = 'submit'
  addButton.className = 'settings-action-button'
  addButton.textContent = 'Add member'
  addForm.appendChild(addButton)
  addForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const emailValue = addInput.value.trim()
    if (!emailValue) return
    context.onAdd(emailValue)
    addInput.value = ''
  })
  addSection.appendChild(addForm)
  if (state.addError) {
    const error = document.createElement('p')
    error.className = 'settings-error'
    error.textContent = state.addError
    addSection.appendChild(error)
  }
  container.appendChild(addSection)

  const backButton = document.createElement('button')
  backButton.type = 'button'
  backButton.className = 'settings-back-button'
  backButton.textContent = '← Back'
  backButton.addEventListener('click', context.onBack)
  container.appendChild(backButton)

  return container
}
```

- [ ] **Step 2: Add CSS for the roster**

In `src/sidepanel/style.css`, add after the `.org-pending-banner { ... }` rule:

```css
.manage-org {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.roster-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.roster-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  flex-wrap: wrap;
}

.roster-row-email {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.roster-row-status {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.roster-row-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.roster-add-form {
  display: flex;
  gap: 6px;
}

.roster-add-form input {
  flex: 1;
  font: inherit;
  padding: 6px 8px;
  background: var(--surface-input);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
}
```

- [ ] **Step 3: Wire the new view mode into `render.ts`**

In `src/sidepanel/render.ts`, add to the imports:

```ts
import { renderManageOrganisation, type ManageOrgState } from './ManageOrganisation'
```

Change the `View` type from:

```ts
export type View =
  | { mode: 'list' }
  | { mode: 'form'; button: Button | null }
  | { mode: 'settings' }
  | { mode: 'org-onboarding' }
```

to:

```ts
export type View =
  | { mode: 'list' }
  | { mode: 'form'; button: Button | null }
  | { mode: 'settings' }
  | { mode: 'org-onboarding' }
  | { mode: 'manage-org' }
```

Add to `RenderContext`, alongside `onOnboardingSubmit`/`onOnboardingCancel`:

```ts
  onOpenManageOrg: () => void
  onManageOrgBack: () => void
  onApproveMember: (email: string) => void
  onRemoveMember: (email: string) => void
  onPromoteMember: (email: string) => void
  onDemoteMember: (email: string) => void
  onAddMember: (email: string) => void
```

Change the `renderApp` signature to insert `manageOrgState` after `teamPrompts`:

```ts
export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  session: { email: string } | null,
  orgSession: OrgSessionState | null,
  teamPrompts: OrgPromptsResult,
  manageOrgState: ManageOrgState,
  context: RenderContext,
): void {
```

In the existing `if (view.mode === 'settings')` block, add `orgSession` and `onOpenManageOrg` to the object passed to `renderSettingsPanel`:

```ts
  if (view.mode === 'settings') {
    root.appendChild(
      renderSettingsPanel({
        onExport: context.onExport,
        onImport: context.onImport,
        onBack: context.onSettingsBack,
        importError: settingsState.error,
        importSuccessCount: settingsState.successCount,
        session,
        onSignIn: context.onSignIn,
        onSignOut: context.onSignOut,
        orgSession,
        onOpenManageOrg: context.onOpenManageOrg,
      }),
    )
    return
  }
```

Add a new branch, immediately after the `org-onboarding` branch from Task 10:

```ts
  if (view.mode === 'manage-org') {
    root.appendChild(
      renderManageOrganisation(manageOrgState, {
        onApprove: context.onApproveMember,
        onRemove: context.onRemoveMember,
        onPromote: context.onPromoteMember,
        onDemote: context.onDemoteMember,
        onAdd: context.onAddMember,
        onBack: context.onManageOrgBack,
      }),
    )
    return
  }
```

- [ ] **Step 4: Add the "Manage Organisation" entry point to Settings**

In `src/sidepanel/SettingsPanel.ts`, add these imports at the top:

```ts
import type { OrgSessionState } from '../shared/org-session'
```

Change `SettingsPanelContext` to add two fields:

```ts
export interface SettingsPanelContext {
  onExport: () => void
  onImport: (file: File) => void
  onBack: () => void
  importError: string | null
  importSuccessCount: number | null
  session: { email: string } | null
  onSignIn: () => void
  onSignOut: () => void
  orgSession: OrgSessionState | null
  onOpenManageOrg: () => void
}
```

In the `context.session` branch (the "signed in" branch, where `signedInAs`/`signOutButton` are appended), add a director-only button right after the existing `authSection.appendChild(signOutButton)` line:

```ts
    if (context.orgSession?.state === 'active' && context.orgSession.role === 'director') {
      const manageButton = document.createElement('button')
      manageButton.type = 'button'
      manageButton.className = 'settings-action-button'
      manageButton.textContent = 'Manage Organisation'
      manageButton.addEventListener('click', context.onOpenManageOrg)
      authSection.appendChild(manageButton)
    }
```

- [ ] **Step 5: Wire the roster data flow into `main.ts`**

In `src/sidepanel/main.ts`, update the import from `../shared/org-session` (added in Task 10) to also bring in `type OrgSessionState` (already there) — no change needed there. Add a new import:

```ts
import {
  fetchOrgMembers,
  approveOrgMember,
  removeOrgMember,
  addOrgMember,
  setOrgMemberRole,
  type OrgMember,
} from '../shared/org-members'
import type { ManageOrgState } from './ManageOrganisation'
```

Add module-level state alongside the existing `let orgSession`:

```ts
let orgMembers: OrgMember[] = []
let manageOrgAddError: string | null = null
```

Add a new function near `resolveOrgSession`:

```ts
async function refreshOrgMembers(root: HTMLElement): Promise<void> {
  const idToken = await authAdapter.getValidIdToken()
  if (!idToken) return
  const members = await fetchOrgMembers(idToken)
  if (members) orgMembers = members
  if (view.mode === 'manage-org') await refresh(root)
}
```

Update the call to `renderApp` inside `refresh` to pass a `manageOrgState` object after `teamPrompts`:

```ts
    renderApp(
      root,
      buttons,
      view,
      runState,
      settingsState,
      session,
      orgSession,
      teamPrompts,
      { members: orgMembers, addError: manageOrgAddError },
      {
```

(Note the object literal argument list now spans multiple lines — update the closing of the call correspondingly; the context object literal that follows is otherwise unchanged except for the additions below.)

Add these handlers to the object passed to `renderApp`, alongside `onOnboardingSubmit`/`onOnboardingCancel`:

```ts
      onOpenManageOrg: () => {
        clearRunErrors()
        view = { mode: 'manage-org' }
        void refresh(root)
        void refreshOrgMembers(root)
      },
      onManageOrgBack: () => {
        manageOrgAddError = null
        view = { mode: 'settings' }
        void refresh(root)
      },
      onApproveMember: async (email: string) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) return
        await approveOrgMember(idToken, email)
        await refreshOrgMembers(root)
      },
      onRemoveMember: async (email: string) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) return
        const result = await removeOrgMember(idToken, email)
        if (!result.ok) announce(result.error)
        await refreshOrgMembers(root)
      },
      onPromoteMember: async (email: string) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) return
        const result = await setOrgMemberRole(idToken, email, 'director')
        if (!result.ok) announce(result.error)
        await refreshOrgMembers(root)
      },
      onDemoteMember: async (email: string) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) return
        const result = await setOrgMemberRole(idToken, email, 'member')
        if (!result.ok) announce(result.error)
        await refreshOrgMembers(root)
      },
      onAddMember: async (email: string) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) return
        const added = await addOrgMember(idToken, email)
        manageOrgAddError = added ? null : 'Something went wrong adding that member. Check the console for details.'
        await refreshOrgMembers(root)
      },
```

- [ ] **Step 6: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: existing tests pass; build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/ManageOrganisation.ts src/sidepanel/render.ts src/sidepanel/SettingsPanel.ts src/sidepanel/main.ts src/sidepanel/style.css
git commit -m "feat: add Manage Organisation view with member roster"
```

---

### Task 12: Manage Organisation view — org prompt management

**Files:**
- Modify: `src/sidepanel/ManageOrganisation.ts`
- Modify: `src/sidepanel/render.ts`
- Modify: `src/sidepanel/main.ts`

**Interfaces:**
- Consumes: `OrgPrompt`, `createOrgPrompt`, `updateOrgPrompt`, `deleteOrgPrompt` from `src/shared/org-prompts.ts` (Task 8, `id` field added there).
- Produces: `ManageOrgState` gains `prompts: OrgPrompt[]`, `editingPromptId: string | null`, `promptFormError: string | null`. `ManageOrganisationContext` gains `onCreatePrompt`/`onUpdatePrompt`/`onDeletePrompt`/`onEditPromptClick`/`onCancelEditPrompt`. `RenderContext` (in `render.ts`) gains the same five fields, forwarded through to `renderManageOrganisation`'s context argument.

This is manual-verification-only, matching every other Manage Organisation UI task. No new CSS is needed — this task's markup reuses `.roster-list`/`.roster-row`/`.roster-row-email`/`.roster-row-status`/`.roster-row-actions` (Task 11) and `.edit-form`/`.type-toggle`/`.settings-error` (existing, from the personal-button edit form).

- [ ] **Step 1: Extend `ManageOrgState` and `ManageOrganisationContext`**

In `src/sidepanel/ManageOrganisation.ts`, add this import at the top:

```ts
import type { OrgPrompt } from '../shared/org-prompts'
```

Change `ManageOrgState` from:

```ts
export interface ManageOrgState {
  members: OrgMember[]
  addError: string | null
}
```

to:

```ts
export interface ManageOrgState {
  members: OrgMember[]
  addError: string | null
  prompts: OrgPrompt[]
  editingPromptId: string | null
  promptFormError: string | null
}
```

Change `ManageOrganisationContext` from:

```ts
export interface ManageOrganisationContext {
  onApprove: (email: string) => void
  onRemove: (email: string) => void
  onPromote: (email: string) => void
  onDemote: (email: string) => void
  onAdd: (email: string) => void
  onBack: () => void
}
```

to:

```ts
export interface ManageOrganisationContext {
  onApprove: (email: string) => void
  onRemove: (email: string) => void
  onPromote: (email: string) => void
  onDemote: (email: string) => void
  onAdd: (email: string) => void
  onCreatePrompt: (data: { name: string; promptText: string; type: 'prompt' | 'skill' }) => void
  onUpdatePrompt: (id: string, data: { name: string; promptText: string; type: 'prompt' | 'skill' }) => void
  onDeletePrompt: (id: string) => void
  onEditPromptClick: (prompt: OrgPrompt) => void
  onCancelEditPrompt: () => void
  onBack: () => void
}
```

- [ ] **Step 2: Add the prompts section**

In `src/sidepanel/ManageOrganisation.ts`, insert the following block into `renderManageOrganisation`, immediately after `container.appendChild(addSection)` (the end of the member-roster's add-by-email section) and before the existing `const backButton = ...` block:

```ts
  const promptsHeading = document.createElement('h3')
  promptsHeading.className = 'team-section-heading'
  promptsHeading.textContent = 'Organisation prompts'
  container.appendChild(promptsHeading)

  const promptsList = document.createElement('ul')
  promptsList.className = 'roster-list'
  state.prompts.forEach((prompt) => {
    const item = document.createElement('li')
    item.className = 'roster-row'

    const name = document.createElement('span')
    name.className = 'roster-row-email'
    name.textContent = prompt.name
    item.appendChild(name)

    const type = document.createElement('span')
    type.className = 'roster-row-status'
    type.textContent = prompt.type === 'skill' ? 'Skill' : 'Prompt'
    item.appendChild(type)

    const actions = document.createElement('div')
    actions.className = 'roster-row-actions'

    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'settings-action-button'
    editButton.textContent = 'Edit'
    editButton.addEventListener('click', () => context.onEditPromptClick(prompt))
    actions.appendChild(editButton)

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'icon-button icon-button-danger'
    deleteButton.textContent = 'Delete'
    deleteButton.addEventListener('click', () => context.onDeletePrompt(prompt.id))
    actions.appendChild(deleteButton)

    item.appendChild(actions)
    promptsList.appendChild(item)
  })
  container.appendChild(promptsList)

  const editingPrompt = state.prompts.find((p) => p.id === state.editingPromptId) ?? null

  const promptForm = document.createElement('form')
  promptForm.className = 'edit-form'

  const promptTypeToggle = document.createElement('div')
  promptTypeToggle.className = 'type-toggle'
  const promptTypeOption = document.createElement('label')
  promptTypeOption.className = 'type-toggle-option'
  const promptTypeRadio = document.createElement('input')
  promptTypeRadio.type = 'radio'
  promptTypeRadio.name = 'org-prompt-type'
  promptTypeRadio.value = 'prompt'
  promptTypeRadio.checked = (editingPrompt?.type ?? 'prompt') === 'prompt'
  promptTypeOption.appendChild(promptTypeRadio)
  promptTypeOption.appendChild(document.createTextNode('Prompt'))
  promptTypeToggle.appendChild(promptTypeOption)
  const skillTypeOption = document.createElement('label')
  skillTypeOption.className = 'type-toggle-option'
  const skillTypeRadio = document.createElement('input')
  skillTypeRadio.type = 'radio'
  skillTypeRadio.name = 'org-prompt-type'
  skillTypeRadio.value = 'skill'
  skillTypeRadio.checked = editingPrompt?.type === 'skill'
  skillTypeOption.appendChild(skillTypeRadio)
  skillTypeOption.appendChild(document.createTextNode('Skill'))
  promptTypeToggle.appendChild(skillTypeOption)
  promptForm.appendChild(promptTypeToggle)

  const promptNameLabel = document.createElement('label')
  promptNameLabel.textContent = 'Name'
  const promptNameInput = document.createElement('input')
  promptNameInput.type = 'text'
  promptNameInput.required = true
  promptNameInput.value = editingPrompt?.name ?? ''
  promptNameLabel.appendChild(promptNameInput)
  promptForm.appendChild(promptNameLabel)

  const promptTextLabel = document.createElement('label')
  promptTextLabel.textContent = 'Prompt text'
  const promptTextInput = document.createElement('textarea')
  promptTextInput.required = true
  promptTextInput.rows = 6
  promptTextInput.value = editingPrompt?.promptText ?? ''
  promptTextLabel.appendChild(promptTextInput)
  promptForm.appendChild(promptTextLabel)

  const promptActions = document.createElement('div')
  promptActions.className = 'edit-form-actions'
  if (state.editingPromptId) {
    const cancelEditButton = document.createElement('button')
    cancelEditButton.type = 'button'
    cancelEditButton.textContent = 'Cancel'
    cancelEditButton.addEventListener('click', context.onCancelEditPrompt)
    promptActions.appendChild(cancelEditButton)
  }
  const promptSubmitButton = document.createElement('button')
  promptSubmitButton.type = 'submit'
  promptSubmitButton.textContent = state.editingPromptId ? 'Save prompt' : 'Add prompt'
  promptActions.appendChild(promptSubmitButton)
  promptForm.appendChild(promptActions)

  promptForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = promptNameInput.value.trim()
    const promptText = promptTextInput.value.trim()
    if (!name || !promptText) return
    const type: 'prompt' | 'skill' = skillTypeRadio.checked ? 'skill' : 'prompt'
    if (state.editingPromptId) {
      context.onUpdatePrompt(state.editingPromptId, { name, promptText, type })
    } else {
      context.onCreatePrompt({ name, promptText, type })
    }
  })

  container.appendChild(promptForm)

  if (state.promptFormError) {
    const promptError = document.createElement('p')
    promptError.className = 'settings-error'
    promptError.textContent = state.promptFormError
    container.appendChild(promptError)
  }
```

- [ ] **Step 3: Forward the new context fields through `render.ts`**

In `src/sidepanel/render.ts`, add to `RenderContext`, alongside `onAddMember`:

```ts
  onCreatePrompt: (data: { name: string; promptText: string; type: 'prompt' | 'skill' }) => void
  onUpdatePrompt: (id: string, data: { name: string; promptText: string; type: 'prompt' | 'skill' }) => void
  onDeletePrompt: (id: string) => void
  onEditPromptClick: (prompt: OrgPrompt) => void
  onCancelEditPrompt: () => void
```

Add this import:

```ts
import type { OrgPrompt } from '../shared/org-prompts'
```

(`OrgPrompt` may already be imported in the existing `import type { OrgPrompt, OrgPromptsResult } from '../shared/org-prompts'` line from Phase 2C — if so, add nothing new, just confirm `OrgPrompt` is present in that existing import rather than adding a duplicate line.)

Update the `manage-org` branch (added in Task 11) from:

```ts
  if (view.mode === 'manage-org') {
    root.appendChild(
      renderManageOrganisation(manageOrgState, {
        onApprove: context.onApproveMember,
        onRemove: context.onRemoveMember,
        onPromote: context.onPromoteMember,
        onDemote: context.onDemoteMember,
        onAdd: context.onAddMember,
        onBack: context.onManageOrgBack,
      }),
    )
    return
  }
```

to:

```ts
  if (view.mode === 'manage-org') {
    root.appendChild(
      renderManageOrganisation(manageOrgState, {
        onApprove: context.onApproveMember,
        onRemove: context.onRemoveMember,
        onPromote: context.onPromoteMember,
        onDemote: context.onDemoteMember,
        onAdd: context.onAddMember,
        onCreatePrompt: context.onCreatePrompt,
        onUpdatePrompt: context.onUpdatePrompt,
        onDeletePrompt: context.onDeletePrompt,
        onEditPromptClick: context.onEditPromptClick,
        onCancelEditPrompt: context.onCancelEditPrompt,
        onBack: context.onManageOrgBack,
      }),
    )
    return
  }
```

- [ ] **Step 4: Wire prompt management into `main.ts`**

In `src/sidepanel/main.ts`, add this import alongside the existing `org-prompts` import:

```ts
import { createOrgPrompt, updateOrgPrompt, deleteOrgPrompt, type OrgPrompt } from '../shared/org-prompts'
```

(Note: `type OrgPromptsResult` and `OrgPrompt` may already both be imported from `'../shared/org-prompts'` in the existing `import { loadOrgPrompts, clearCachedOrgPrompts, type OrgPrompt, type OrgPromptsResult } from '../shared/org-prompts'` line — if so, add `createOrgPrompt, updateOrgPrompt, deleteOrgPrompt` into that same existing import statement instead of a new line, and remove the duplicate `OrgPrompt` import shown above.)

Add module-level state alongside `let manageOrgAddError`:

```ts
let orgPrompts: OrgPrompt[] = []
let editingPromptId: string | null = null
let promptFormError: string | null = null
```

Add a function near `refreshOrgMembers`:

```ts
async function refreshOrgPrompts(root: HTMLElement): Promise<void> {
  const idToken = await authAdapter.getValidIdToken()
  if (!idToken) return
  const result = await loadOrgPrompts(idToken)
  orgPrompts = result.prompts
  if (view.mode === 'manage-org') await refresh(root)
}
```

Update the `manageOrgState` object literal passed to `renderApp` (from Task 11) from:

```ts
      { members: orgMembers, addError: manageOrgAddError },
```

to:

```ts
      {
        members: orgMembers,
        addError: manageOrgAddError,
        prompts: orgPrompts,
        editingPromptId,
        promptFormError,
      },
```

Update the existing `onOpenManageOrg` handler to also load prompts — change:

```ts
      onOpenManageOrg: () => {
        clearRunErrors()
        view = { mode: 'manage-org' }
        void refresh(root)
        void refreshOrgMembers(root)
      },
```

to:

```ts
      onOpenManageOrg: () => {
        clearRunErrors()
        view = { mode: 'manage-org' }
        void refresh(root)
        void refreshOrgMembers(root)
        void refreshOrgPrompts(root)
      },
```

Update the existing `onManageOrgBack` handler to also clear prompt-editing state — change:

```ts
      onManageOrgBack: () => {
        manageOrgAddError = null
        view = { mode: 'settings' }
        void refresh(root)
      },
```

to:

```ts
      onManageOrgBack: () => {
        manageOrgAddError = null
        editingPromptId = null
        promptFormError = null
        view = { mode: 'settings' }
        void refresh(root)
      },
```

Add these handlers to the object passed to `renderApp`, alongside `onAddMember`:

```ts
      onCreatePrompt: async (data) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) return
        const created = await createOrgPrompt(idToken, data)
        promptFormError = created ? null : 'Something went wrong adding that prompt. Check the console for details.'
        await refreshOrgPrompts(root)
      },
      onUpdatePrompt: async (id, data) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) return
        const updated = await updateOrgPrompt(idToken, id, data)
        if (updated) editingPromptId = null
        promptFormError = updated ? null : 'Something went wrong saving that prompt. Check the console for details.'
        await refreshOrgPrompts(root)
      },
      onDeletePrompt: async (id: string) => {
        const idToken = await authAdapter.getValidIdToken()
        if (!idToken) return
        await deleteOrgPrompt(idToken, id)
        await refreshOrgPrompts(root)
      },
      onEditPromptClick: (prompt: OrgPrompt) => {
        editingPromptId = prompt.id
        promptFormError = null
        void refresh(root)
      },
      onCancelEditPrompt: () => {
        editingPromptId = null
        promptFormError = null
        void refresh(root)
      },
```

- [ ] **Step 5: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: existing tests pass; build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/ManageOrganisation.ts src/sidepanel/render.ts src/sidepanel/main.ts
git commit -m "feat: add org prompt create/edit/delete forms to Manage Organisation"
```

---

### Task 13: Usage table + periodic usage reporting

**Files:**
- Modify: `src/shared/usage-report.ts`
- Modify: `tests/shared/usage-report.test.ts`
- Modify: `src/sidepanel/ManageOrganisation.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/style.css`

**Interfaces:**
- Consumes: `GetUsageRequest`/`GetUsageResponse` (Task 9), `OrgSessionState` (Task 6), `API_BASE_URL` (Task 6).
- Produces: `OrgUsageSnapshot` type, `parseOrgUsageResponse(raw): OrgUsageSnapshot[]`, `fetchOrgUsage(idToken): Promise<OrgUsageSnapshot[] | null>` from `src/shared/usage-report.ts`. `ManageOrgState` gains `usageSnapshots: OrgUsageSnapshot[]`. A periodic usage-reporting timer in `main.ts`, started when `orgSession.state === 'active'` and stopped on sign-out or any other state.

The last task in this plan — after this, every requirement in the design spec has a task.

- [ ] **Step 1: Write the failing tests for parsing the org-usage response**

Create `tests/shared/usage-report.test.ts`... — **wait, this file already exists from Task 9.** Add to the existing `tests/shared/usage-report.test.ts`, a new `describe` block after the existing `usageSnapshotToReportBody` block:

```ts
import { parseOrgUsageResponse } from '../../src/shared/usage-report'

describe('parseOrgUsageResponse', () => {
  it('parses a list of usage snapshots', () => {
    const raw = {
      snapshots: [
        { email: 'alice@acme.com', sessionPercent: 12, weeklyPercent: 25, spendPercent: null, updatedAt: '2026-08-19T00:00:00Z' },
      ],
    }
    expect(parseOrgUsageResponse(raw)).toEqual([
      { email: 'alice@acme.com', sessionPercent: 12, weeklyPercent: 25, spendPercent: null, updatedAt: '2026-08-19T00:00:00Z' },
    ])
  })

  it('skips an entry missing email', () => {
    const raw = { snapshots: [{ sessionPercent: 12, weeklyPercent: 25, spendPercent: null, updatedAt: 'x' }] }
    expect(parseOrgUsageResponse(raw)).toEqual([])
  })

  it('returns an empty array when snapshots is missing', () => {
    expect(parseOrgUsageResponse({})).toEqual([])
  })

  it('returns an empty array for non-object input, without throwing', () => {
    expect(parseOrgUsageResponse(null)).toEqual([])
    expect(parseOrgUsageResponse('nope')).toEqual([])
  })
})
```

(Add the `parseOrgUsageResponse` name to the existing `import { usageSnapshotToReportBody } from '../../src/shared/usage-report'` line at the top of the file, rather than a second import statement.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- usage-report.test.ts`
Expected: FAIL — `parseOrgUsageResponse is not a function` (or similar import error).

- [ ] **Step 3: Implement `parseOrgUsageResponse` and `fetchOrgUsage`**

In `src/shared/usage-report.ts`, add this import alongside the existing one:

```ts
import { API_BASE_URL } from './org-prompts'
```

(Already present from Task 9 — do not duplicate the import line, just confirm it's there.)

Add at the end of the file:

```ts
export interface OrgUsageSnapshot {
  email: string
  sessionPercent: number | null
  weeklyPercent: number | null
  spendPercent: number | null
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPercentOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function parseSnapshot(entry: unknown): OrgUsageSnapshot | null {
  if (!isRecord(entry)) return null
  const email = entry.email
  const sessionPercent = entry.sessionPercent
  const weeklyPercent = entry.weeklyPercent
  const spendPercent = entry.spendPercent
  const updatedAt = entry.updatedAt
  if (typeof email !== 'string' || typeof updatedAt !== 'string') return null
  if (!isPercentOrNull(sessionPercent) || !isPercentOrNull(weeklyPercent) || !isPercentOrNull(spendPercent)) {
    return null
  }
  return { email, sessionPercent, weeklyPercent, spendPercent, updatedAt }
}

export function parseOrgUsageResponse(raw: unknown): OrgUsageSnapshot[] {
  if (!isRecord(raw) || !Array.isArray(raw.snapshots)) return []
  const snapshots: OrgUsageSnapshot[] = []
  for (const entry of raw.snapshots) {
    const snapshot = parseSnapshot(entry)
    if (snapshot) snapshots.push(snapshot)
  }
  return snapshots
}

export async function fetchOrgUsage(idToken: string): Promise<OrgUsageSnapshot[] | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-usage`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org usage', error)
    return null
  }
  if (!response.ok) {
    console.error('[Claude Tools] org-usage endpoint returned status', response.status)
    return null
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-usage response was not valid JSON', error)
    return null
  }
  return parseOrgUsageResponse(body)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- usage-report.test.ts`
Expected: PASS, all 8 tests green (4 existing from Task 9, 4 new).

- [ ] **Step 5: Add the usage table to the Manage Organisation view**

In `src/sidepanel/ManageOrganisation.ts`, add this import:

```ts
import type { OrgUsageSnapshot } from '../shared/usage-report'
```

Add `usageSnapshots: OrgUsageSnapshot[]` to `ManageOrgState`:

```ts
export interface ManageOrgState {
  members: OrgMember[]
  addError: string | null
  prompts: OrgPrompt[]
  editingPromptId: string | null
  promptFormError: string | null
  usageSnapshots: OrgUsageSnapshot[]
}
```

Insert the following block into `renderManageOrganisation`, immediately after the prompt-form error block from Task 12 (`if (state.promptFormError) { ... }`) and before the existing `const backButton = ...` block:

```ts
  const usageHeading = document.createElement('h3')
  usageHeading.className = 'team-section-heading'
  usageHeading.textContent = 'Member usage'
  container.appendChild(usageHeading)

  if (state.usageSnapshots.length === 0) {
    const emptyUsage = document.createElement('p')
    emptyUsage.className = 'settings-hint'
    emptyUsage.textContent = 'No usage reported yet.'
    container.appendChild(emptyUsage)
  } else {
    const usageList = document.createElement('ul')
    usageList.className = 'roster-list'
    state.usageSnapshots.forEach((snapshot) => {
      const item = document.createElement('li')
      item.className = 'roster-row'

      const email = document.createElement('span')
      email.className = 'roster-row-email'
      email.textContent = snapshot.email
      item.appendChild(email)

      const percents = document.createElement('span')
      percents.className = 'roster-row-status'
      const parts = [
        snapshot.sessionPercent !== null ? `Session ${snapshot.sessionPercent}%` : null,
        snapshot.weeklyPercent !== null ? `Weekly ${snapshot.weeklyPercent}%` : null,
        snapshot.spendPercent !== null ? `Spend ${snapshot.spendPercent}%` : null,
      ].filter((part): part is string => part !== null)
      percents.textContent = parts.length > 0 ? parts.join(' · ') : 'No data'
      item.appendChild(percents)

      usageList.appendChild(item)
    })
    container.appendChild(usageList)
  }
```

- [ ] **Step 6: Wire usage fetching and the reporting timer into `main.ts`**

In `src/sidepanel/main.ts`, add this import:

```ts
import { reportUsage, fetchOrgUsage, type OrgUsageSnapshot } from '../shared/usage-report'
import type { GetUsageRequest, GetUsageResponse } from '../shared/messages'
```

Add module-level state alongside `let promptFormError`:

```ts
let orgUsageSnapshots: OrgUsageSnapshot[] = []
const USAGE_REPORT_INTERVAL_MS = 15 * 60 * 1000
let usageReportTimer: ReturnType<typeof setInterval> | null = null
```

Add these functions near `refreshOrgPrompts`:

```ts
async function refreshOrgUsage(root: HTMLElement): Promise<void> {
  const idToken = await authAdapter.getValidIdToken()
  if (!idToken) return
  const snapshots = await fetchOrgUsage(idToken)
  if (snapshots) orgUsageSnapshots = snapshots
  if (view.mode === 'manage-org') await refresh(root)
}

async function reportCurrentUsage(): Promise<void> {
  const idToken = await authAdapter.getValidIdToken()
  if (!idToken) return
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url) return
    const response = await chrome.tabs.sendMessage<GetUsageRequest, GetUsageResponse>(tab.id, {
      type: 'GET_USAGE',
    })
    if (response.ok) await reportUsage(idToken, response.usage)
  } catch (error) {
    console.error('[Claude Tools] failed to report usage', error)
  }
}

function startUsageReportTimer(): void {
  if (usageReportTimer) return
  void reportCurrentUsage()
  usageReportTimer = setInterval(() => void reportCurrentUsage(), USAGE_REPORT_INTERVAL_MS)
}

function stopUsageReportTimer(): void {
  if (usageReportTimer) {
    clearInterval(usageReportTimer)
    usageReportTimer = null
  }
}
```

Update the `manageOrgState` object literal passed to `renderApp` (from Task 12) to add `usageSnapshots: orgUsageSnapshots` alongside `promptFormError`.

Update the existing `onOpenManageOrg` handler to also load usage — change:

```ts
      onOpenManageOrg: () => {
        clearRunErrors()
        view = { mode: 'manage-org' }
        void refresh(root)
        void refreshOrgMembers(root)
        void refreshOrgPrompts(root)
      },
```

to:

```ts
      onOpenManageOrg: () => {
        clearRunErrors()
        view = { mode: 'manage-org' }
        void refresh(root)
        void refreshOrgMembers(root)
        void refreshOrgPrompts(root)
        void refreshOrgUsage(root)
      },
```

Inside `resolveOrgSession`, start or stop the timer based on the resolved state. Change the block:

```ts
  if (resolution?.state === 'active') {
    const result = await loadOrgPrompts(idToken)
    if (session !== startedForSession) return
    teamPrompts = result
  } else {
    teamPrompts = { orgName: null, prompts: [] }
  }
  if (view.mode === 'list') await refresh(root)
```

to:

```ts
  if (resolution?.state === 'active') {
    const result = await loadOrgPrompts(idToken)
    if (session !== startedForSession) return
    teamPrompts = result
    startUsageReportTimer()
  } else {
    teamPrompts = { orgName: null, prompts: [] }
    stopUsageReportTimer()
  }
  if (view.mode === 'list') await refresh(root)
```

Also stop the timer in the no-token branch earlier in the same function — change:

```ts
    orgSession = null
    teamPrompts = { orgName: null, prompts: [] }
    if (view.mode === 'list') await refresh(root)
    return
  }
```

(the one inside the `if (!idToken) { ... }` block) to:

```ts
    orgSession = null
    teamPrompts = { orgName: null, prompts: [] }
    stopUsageReportTimer()
    if (view.mode === 'list') await refresh(root)
    return
  }
```

Finally, add `stopUsageReportTimer()` to both `onSignOut` and `onOnboardingCancel` (call it right after `session = null` in each):

```ts
      onSignOut: async () => {
        await authAdapter.signOut()
        await clearCachedOrgPrompts()
        session = null
        stopUsageReportTimer()
        orgSession = null
        teamPrompts = { orgName: null, prompts: [] }
        if (view.mode === 'org-onboarding') view = { mode: 'list' }
        await refresh(root)
      },
```

```ts
      onOnboardingCancel: async () => {
        await authAdapter.signOut()
        await clearCachedOrgPrompts()
        session = null
        stopUsageReportTimer()
        orgSession = null
        teamPrompts = { orgName: null, prompts: [] }
        view = { mode: 'list' }
        await refresh(root)
      },
```

- [ ] **Step 7: Add CSS**

No new CSS is needed — the usage table reuses `.roster-list`/`.roster-row`/`.roster-row-email`/`.roster-row-status` (Task 11). Skip this step; it's listed only so a reader doesn't wonder why `style.css` isn't touched despite being listed under Files — it's listed because earlier drafts of this task expected new rules; none turned out to be needed.

- [ ] **Step 8: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: all tests pass; build succeeds with no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/shared/usage-report.ts tests/shared/usage-report.test.ts src/sidepanel/ManageOrganisation.ts src/sidepanel/main.ts
git commit -m "feat: add member usage table and periodic usage reporting"
```

---

## Manual verification (after all tasks land)

None of this plan's extension-side UI tasks have automated coverage beyond their pure parsing logic, per this project's established convention. Before considering Phase 2D done, deploy the backend (including the Task 1 migration against the real database) and, in a loaded unpacked build of the extension:

1. **Bootstrap:** sign in with a Google account at a domain with no existing organization. Confirm the onboarding screen appears, submit an organisation name, confirm you land back in the list view as director, and that "Manage Organisation" appears in Settings.
2. **Auto-join + approval:** sign in with a second account at the same company domain (a real or test domain you control). Confirm it lands in the "waiting for approval" pending state, with personal buttons still fully usable. From the first (director) account's Manage Organisation view, approve the pending member; confirm the second account's Team section appears on its next sidebar open.
3. **Public domain:** sign in with a `gmail.com`/similar account. Confirm it goes straight to onboarding (never auto-joins any existing org), and that a second, unrelated `gmail.com` account also gets its own separate onboarding rather than joining the first one's org.
4. **Add by email + last-director guard:** from the director's Manage Organisation view, add a third email directly and confirm it shows active immediately (no pending step) once that person signs in. Try demoting the only director to member and confirm it's refused with a clear message; promote a second member to director first, then confirm the original director can now be demoted.
5. **Prompt CRUD:** as director, create, edit, and delete an organisation prompt from Manage Organisation; confirm each change is reflected in every member's Team section on their next refresh.
6. **Usage reporting:** as an active (approved) member, use claude.ai for a bit, then check the director's Manage Organisation usage table shows that member's session/weekly/spend percentages. Sign that member out and confirm no further usage reports appear for them (check the sidepanel's own DevTools console for the absence of new `usage-report` calls).
7. **Removed-member re-request:** remove an active member, then sign in again as that same account and confirm it lands back in the pending queue rather than being blocked outright.
