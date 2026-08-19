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

Isolation between organizations depends on `schema.sql`'s
`force row level security` line, not just the `WHERE org_id = ...` clause
in the API code -- defense-in-depth is the point. Note that this only
holds as long as the role in `DATABASE_URL` is a plain, non-superuser role
without the `BYPASSRLS` attribute; either of those would silently defeat
`FORCE ROW LEVEL SECURITY` and re-open cross-tenant access. Once real data
exists, it's worth manually verifying: seed two organizations with
different domains and their own prompts, sign in as a user at each
domain, and confirm each only ever sees their own organization's prompts,
never the other's.

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
POST   /api/org-prompts        { "name", "promptText", "type" }         (director-only) -> 201
PATCH  /api/org-prompts/:id    { "name"?, "promptText"?, "type"? }        (director-only) -> 204
DELETE /api/org-prompts/:id                                               (director-only) -> 204
```

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
