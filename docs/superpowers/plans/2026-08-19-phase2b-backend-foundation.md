# Phase 2B: Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Neon Postgres database and a small Vercel serverless API that verifies a Google sign-in token, resolves the caller's org by email domain, and returns that org's shared prompts.

**Architecture:** A new `backend/` directory in this same repo (not a separate repo — Vercel deploys a subdirectory fine, and this avoids a second git remote for a small project), deployed to Vercel, reading/writing Neon Postgres via its serverless HTTP driver. One read-only endpoint, no write path in this slice.

**Tech Stack:** TypeScript, pnpm, Vercel serverless functions (`@vercel/node`), `@neondatabase/serverless`, `google-auth-library`, Vitest for the pure logic.

**Spec:** `docs/superpowers/specs/2026-08-18-phase2-login-team-storage-design.md`

## Global Constraints

- Package manager is pnpm, never npm — same as the rest of this repo.
- Hosting is Vercel, chosen specifically for its first-party Neon integration.
- The backend lives in `backend/` at the repo root and is entirely separate from the extension's own `src/` — this plan does not touch any extension code.
- Token verification uses Google's own `google-auth-library` (`OAuth2Client.verifyIdToken`) — never hand-rolled JWT/JWKS verification.
- Database access uses `@neondatabase/serverless`'s HTTP/serverless driver, not a traditional persistent `pg` connection — Vercel functions are short-lived and this driver is built for exactly that.
- No `users` table in this slice — org membership is resolved per-request from the verified email's domain (see spec's "Explicitly out of scope").
- No write endpoint exists in this slice — `GET /api/org-prompts` is the only route.
- Isolation is enforced at the database layer via Postgres Row Level Security on `org_id`, not only by the API's own query logic — defense in depth per the spec's NFRs.
- Testing convention: pure logic (domain-matching) gets full TDD coverage in Vitest. The actual Vercel function handler is manual-verification-only (no local Vercel dev environment assumed) — same "can't unit-test platform integration" boundary this whole project already draws for content-script/UI code.

---

## Prerequisites

These are manual steps in third-party consoles — nothing here is code, and nothing in this plan's tasks depends on these being done first (the code can be written and reviewed without live accounts existing). But the code can't actually run end-to-end until these are complete. Exact button labels in these consoles may drift from what's written here since they're outside this repo — treat this as "what to look for," not a guaranteed click-by-click script.

**1. Create a Neon project**
- Go to [neon.tech](https://neon.tech), sign up/sign in, create a new project.
- From the project's dashboard, copy the connection string (a `postgresql://...` URL) — you'll need this as a Vercel environment variable in step 3. Keep it private; it's a real database credential.

**2. Create a Google OAuth Client ID for the extension**
- Go to [console.cloud.google.com](https://console.cloud.google.com), create a new project (or reuse one).
- Navigate to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
- Choose application type **Chrome Extension** (this type specifically expects your unpacked extension's ID, not a redirect URL).
- Find your extension's ID: open `chrome://extensions`, ensure Developer Mode is on, and copy the ID shown on the "Claude Tools Sidebar" card.
- Paste that ID where the Google Cloud form asks for the application ID, and create the client.
- Copy the resulting **Client ID** (looks like `123456789-abc...apps.googleusercontent.com`) — you'll need it both as a Vercel environment variable (step 3) and later when wiring up the extension side (Phase 2C, not this plan).

**3. Create a Vercel project for `backend/`**
- Go to [vercel.com](https://vercel.com), sign up/sign in, and either install the **Neon integration** from Vercel's integrations marketplace (which can auto-wire the connection string for you), or plan to add it manually.
- Import this GitHub repo as a new Vercel project, and set its **Root Directory** to `backend` (Vercel supports deploying a subdirectory of a repo — look for this setting during import, or in the project's Settings → General afterward).
- Add two environment variables to the Vercel project (Settings → Environment Variables), unless the Neon integration already added the first one for you:
  - `DATABASE_URL` — the Neon connection string from step 1.
  - `GOOGLE_OAUTH_CLIENT_ID` — the Client ID from step 2.
- Once Tasks 1-5 below are committed and pushed, Vercel will deploy automatically on push (or trigger a manual deploy from its dashboard). Note the deployment URL it gives you (e.g. `https://your-project.vercel.app`) — you'll need it for Phase 2C.

**Not part of this plan:** seeding real organization data. Once the schema exists (Task 1), add your own company as a test row directly in Neon's SQL Editor, e.g.:

```sql
insert into organizations (name, domain) values ('Your Company', 'yourcompany.com');
```

This is a manual follow-up step after this plan's tasks are done, not a task in the plan itself — it uses your own real domain, which only you should enter.

---

### Task 1: Database schema

**Files:**
- Create: `backend/schema.sql`

**Interfaces:**
- Produces: the `organizations` and `prompts` tables, and the `org_isolation` RLS policy, that every later task's queries depend on.

- [ ] **Step 1: Write the schema file**

Create `backend/schema.sql`:

```sql
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

create policy org_isolation on prompts
  for select
  using (org_id = current_setting('app.current_org_id', true)::uuid);
```

- [ ] **Step 2: Commit**

```bash
git add backend/schema.sql
git commit -m "feat: add backend database schema"
```

(This file has no automated test — it's verified by actually running it against Neon during the Prerequisites steps, and by Task 4's API code successfully querying against it once deployed.)

---

### Task 2: Backend project setup

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/.gitignore`

**Interfaces:**
- Produces: a working `pnpm test` / `pnpm typecheck` setup inside `backend/` that Task 3 depends on to run its tests.

- [ ] **Step 1: Write `backend/package.json`**

```json
{
  "name": "claude-tools-backend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.0",
    "google-auth-library": "^9.14.0"
  },
  "devDependencies": {
    "@vercel/node": "^3.2.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Write `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["api", "lib", "**/*.test.ts"]
}
```

- [ ] **Step 3: Write `backend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Write `backend/.gitignore`**

```
node_modules/
.vercel/
```

- [ ] **Step 5: Install dependencies and verify the empty project builds**

```bash
cd backend
pnpm install
pnpm typecheck
pnpm test
```

Expected: `pnpm typecheck` succeeds trivially (no source files yet), `pnpm test` reports "No test files found" (expected — Task 3 adds the first one).

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/vitest.config.ts backend/.gitignore backend/pnpm-lock.yaml
git commit -m "feat: set up backend project (pnpm, TypeScript, Vitest)"
```

---

### Task 3: Org resolution logic (TDD)

**Files:**
- Create: `backend/lib/resolve-org.ts`
- Test: `backend/lib/resolve-org.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no dependencies on Tasks 1-2's schema/setup beyond the project existing).
- Produces: `OrgRecord` (`{ id: string; domain: string }`), `resolveOrgId(email: string, orgs: OrgRecord[]): string | null` — consumed by Task 4's API handler.

Given the org count is expected to stay small for this minimal slice (a handful of company customers, not thousands), the API fetches all organizations and matches in memory here rather than querying `WHERE domain = ...` — simpler, and the pure matching logic is fully unit-testable without a database. If the orgs table ever grows large, switching to a direct domain-filtered query is a small, isolated change to Task 4 only.

- [ ] **Step 1: Write the failing tests**

Create `backend/lib/resolve-org.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveOrgId } from './resolve-org'

const ORGS = [
  { id: '11111111-1111-1111-1111-111111111111', domain: 'acme.com' },
  { id: '22222222-2222-2222-2222-222222222222', domain: 'example.org' },
]

describe('resolveOrgId', () => {
  it('returns the matching org id for an email at a known domain', () => {
    expect(resolveOrgId('alice@acme.com', ORGS)).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('matches domains case-insensitively', () => {
    expect(resolveOrgId('alice@ACME.COM', ORGS)).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('returns null for an email at an unknown domain', () => {
    expect(resolveOrgId('alice@unknown.com', ORGS)).toBeNull()
  })

  it('returns null for an email with no @ sign', () => {
    expect(resolveOrgId('not-an-email', ORGS)).toBeNull()
  })

  it('returns null when the orgs list is empty', () => {
    expect(resolveOrgId('alice@acme.com', [])).toBeNull()
  })

  it('matches the second org when the domain corresponds to it', () => {
    expect(resolveOrgId('bob@example.org', ORGS)).toBe('22222222-2222-2222-2222-222222222222')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
pnpm test
```

Expected: FAIL — `Cannot find module './resolve-org'`

- [ ] **Step 3: Implement `resolveOrgId`**

Create `backend/lib/resolve-org.ts`:

```ts
export interface OrgRecord {
  id: string
  domain: string
}

export function resolveOrgId(email: string, orgs: OrgRecord[]): string | null {
  const atIndex = email.lastIndexOf('@')
  if (atIndex === -1 || atIndex === email.length - 1) return null

  const domain = email.slice(atIndex + 1).toLowerCase()
  const match = orgs.find((org) => org.domain.toLowerCase() === domain)
  return match ? match.id : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend
pnpm test
```

Expected: PASS, all 6 tests green.

- [ ] **Step 5: Typecheck and commit**

```bash
cd backend
pnpm typecheck
git add backend/lib/resolve-org.ts backend/lib/resolve-org.test.ts
git commit -m "feat: add pure org-resolution-by-email-domain logic"
```

---

### Task 4: The `/api/org-prompts` endpoint

**Files:**
- Create: `backend/api/org-prompts.ts`

**Interfaces:**
- Consumes: `resolveOrgId`, `OrgRecord` from Task 3 (`../lib/resolve-org`).
- Produces: the deployed `GET /api/org-prompts` route, matching the spec's exact contract.

This task is manual-verification-only — there's no local Vercel dev environment assumed, and testing it for real requires the Prerequisites (a live Neon database and deployed Vercel project) to exist. The code below is complete and correct against the schema from Task 1 and the spec's documented contract; verify it by deploying (Task 5) and calling it with a real token once Phase 2C exists to obtain one.

- [ ] **Step 1: Write the handler**

Create `backend/api/org-prompts.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OAuth2Client } from 'google-auth-library'
import { neon } from '@neondatabase/serverless'
import { resolveOrgId, type OrgRecord } from '../lib/resolve-org'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const sql = neon(process.env.DATABASE_URL ?? '')
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID)

interface OrgRow extends OrgRecord {
  name: string
}

interface PromptRow {
  name: string
  prompt_text: string
  type: 'prompt' | 'skill'
}

async function verifyEmail(idToken: string): Promise<string | null> {
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    return ticket.getPayload()?.email ?? null
  } catch (error) {
    console.error('[org-prompts] token verification failed', error)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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

  const orgs = (await sql`SELECT id, name, domain FROM organizations`) as OrgRow[]
  const orgId = resolveOrgId(email, orgs)

  if (!orgId) {
    res.status(200).json({ org: null, prompts: [] })
    return
  }

  const org = orgs.find((candidate) => candidate.id === orgId)
  if (!org) {
    // resolveOrgId only returns ids present in `orgs`, so this is unreachable
    // in practice -- guarding anyway rather than asserting with `!`.
    res.status(200).json({ org: null, prompts: [] })
    return
  }

  const results = await sql.transaction([
    sql`SET LOCAL app.current_org_id = ${orgId}`,
    sql`SELECT name, prompt_text, type FROM prompts`,
  ])
  const prompts = results[1] as PromptRow[]

  res.status(200).json({
    org: { name: org.name },
    prompts: prompts.map((p) => ({ name: p.name, prompt_text: p.prompt_text, type: p.type })),
  })
}
```

- [ ] **Step 2: Typecheck**

```bash
cd backend
pnpm typecheck
```

Expected: clean, zero errors. (This alone doesn't prove the handler works against a live database — that needs Task 5's deployment and a real request.)

- [ ] **Step 3: Commit**

```bash
git add backend/api/org-prompts.ts
git commit -m "feat: add the org-prompts API endpoint"
```

---

### Task 5: Deployment config and docs

**Files:**
- Create: `backend/vercel.json`
- Create: `backend/README.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the deployable Vercel project configuration and the operator-facing documentation for anyone (including future-you) picking this up later.

This task is manual-verification-only — deployment itself happens via the Vercel dashboard/CLI per the Prerequisites section, not via an automated test in this repo.

- [ ] **Step 1: Write `backend/vercel.json`**

```json
{
  "functions": {
    "api/org-prompts.ts": {
      "runtime": "nodejs20.x"
    }
  }
}
```

- [ ] **Step 2: Write `backend/README.md`**

```markdown
# Claude Tools Backend

Minimal Vercel serverless API backing the Claude Tools Sidebar extension's
Phase 2 (company login + centralized prompt storage). See the design spec
at `../docs/superpowers/specs/2026-08-18-phase2-login-team-storage-design.md`
for the full picture — this file just covers running and deploying this
directory.

## Environment variables

Set these in the Vercel project's Settings -> Environment Variables:

- `DATABASE_URL` -- a Neon Postgres connection string.
- `GOOGLE_OAUTH_CLIENT_ID` -- the OAuth Client ID (type "Chrome Extension")
  created in Google Cloud Console for this extension.

## Database setup

Run `schema.sql` once against your Neon database before the API will work:

```bash
psql "$DATABASE_URL" -f schema.sql
```

Then seed at least one organization directly in Neon's SQL Editor:

```sql
insert into organizations (name, domain) values ('Your Company', 'yourcompany.com');
```

## Local development

```bash
pnpm install
pnpm typecheck
pnpm test
```

There's no local Vercel dev server assumed by this project's workflow --
the API is verified by deploying and calling the live endpoint.

## Deploying

Either:
- Connect this GitHub repo to a Vercel project with **Root Directory** set
  to `backend`, so every push to `main` deploys automatically, or
- Run `vercel deploy` from inside this directory using the Vercel CLI.

## API

```
GET /api/org-prompts
Authorization: Bearer <google-id-token>

200 -> { "org": { "name": "Acme" }, "prompts": [ { "name": "...", "prompt_text": "...", "type": "prompt" } ] }
200 -> { "org": null, "prompts": [] }   // token verifies, but no org matches the domain yet
401 -> token missing or invalid
```
```

- [ ] **Step 3: Commit**

```bash
git add backend/vercel.json backend/README.md
git commit -m "docs: add backend deployment config and README"
```
