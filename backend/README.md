# Claude Tools Backend

Minimal Vercel serverless API backing the Claude Tools Sidebar extension's
Phase 2 (company login + centralized prompt storage). See the design spec
at `../docs/superpowers/specs/2026-08-18-phase2-login-team-storage-design.md`
for the full picture — this file just covers running and deploying this
directory.

## Environment variables

Set these in the Vercel project's Settings -> Environment Variables:

- `DATABASE_URL` -- a Neon Postgres connection string.
- `SESSION_JWT_SECRET` -- a long random string (e.g. `openssl rand -hex 32`).
  Used to sign and verify the backend session tokens the extension gets
  from `POST /api/auth/session` and then sends on every other call. Keep
  it secret; it never ships in the extension. If it is unset the API
  still works -- it just falls back to verifying a Clerk id_token on
  every request, the pre-session-token behaviour.
- `CLERK_ISSUER` -- the Clerk instance's Frontend API origin, e.g.
  `https://innocent-lamb-6401.clerk.accounts.dev` (dev) or your custom
  domain (prod). Same value as `CLERK_DOMAIN` in `providers.ts` with the
  `https://` prefix. Clerk id_tokens are verified against
  `${CLERK_ISSUER}/.well-known/jwks.json`.
- `CLERK_OAUTH_CLIENT_ID` -- from the Clerk OAuth application (below).
- `CLERK_OAUTH_CLIENT_SECRET` -- only if that application is confidential
  rather than a public/PKCE client.

### Clerk sign-in setup

Sign-in goes entirely through Clerk. One OAuth application fans out to
Google / GitHub / Microsoft / email / SSO -- whichever connections are
enabled in the dashboard.

1. In the Clerk Dashboard: **Configure -> OAuth Applications -> New
   application**. Scopes: `openid`, `email`, `profile`. Redirect URI
   `https://fhaeedmmhjjkhnopifppigddjbbmdegh.chromiumapp.org/`. Public
   client (PKCE) -- no client secret needed by the extension.
2. Copy the **Client ID** into `CLERK_OAUTH_CLIENT_ID` in
   `src/shared/auth/providers.ts` and confirm `CLERK_DOMAIN` there
   matches your instance.
3. Set `CLERK_ISSUER` (and `CLERK_OAUTH_CLIENT_SECRET` if the app is
   confidential) in Vercel and redeploy.
4. Add the Clerk instance host to `host_permissions` in
   `manifest.config.ts` if your instance domain differs from the default.
5. Turn on the sign-in methods you want under **Social Connections** and
   **SSO Connections**. Clerk's dev instance (`*.clerk.accounts.dev`) has
   no allow-list -- any tester can sign in with an enabled method, no
   per-tester step.

The extension ID is pinned (`key` in `manifest.config.ts`), so every
build of this repo has the same ID and the redirect URI above is
registered **once, ever** -- not per machine.

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

then apply everything from the `create policy org_update on prompts` line
onward in `schema.sql`. Start at that line, **not** at
`create table org_members`: `prompts` is under
`force row level security`, and RLS default-denies any command with no
matching policy, so skipping the `org_update`/`org_delete` policies makes
every director prompt edit and delete match zero rows and silently do
nothing.

If you already applied an earlier version of this phase's `schema.sql`
that had the case-sensitive `unique (org_id, email)` constraint on
`org_members`, replace it with the case-insensitive index (delete any
rows that differ only by email case first):

```sql
update org_members set email = lower(email) where email <> lower(email);
alter table org_members drop constraint org_members_org_id_email_key;
create unique index org_members_org_email_key on org_members (org_id, lower(email));
```

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

Every endpoint's `Authorization: Bearer <token>` accepts **either** a
Clerk id_token **or** a backend session token from `POST /api/auth/session`.
The extension exchanges once after sign-in and then sends the session token.

```
POST /api/auth/session
Authorization: Bearer <token>

200 -> { "sessionToken": "<jwt>", "email": "a@b.com", "expiresAt": "<ISO-8601>" }
401 -> token missing or invalid
500 -> SESSION_JWT_SECRET not configured on the server
```

(GET /api/org-prompts and the shared-tab endpoints are documented together
further down.)

```
POST /api/org-session
Authorization: Bearer <token>

200 -> { "state": "active", "org": { "id": "...", "name": "..." }, "role": "director" | "member" }
200 -> { "state": "pending", "org": { "id": "...", "name": "..." } }
200 -> { "state": "needs_onboarding" }
401 -> token missing or invalid
```

```
POST /api/org-onboarding
Authorization: Bearer <token>
Body: { "orgName": "...", "initialMemberEmails": ["...", "..."] }

200 -> { "outcome": "created", "org": { "id": "...", "name": "..." }, "role": "director" }
200 -> { "outcome": "joined_existing", "org": { "id": "...", "name": "..." } }
400 -> orgName missing/empty, or invalid email
401 -> token missing or invalid
409 -> already a member of an organization
```

```
GET  /api/org-members                                    (director-only)
200 -> { "members": [ { "email", "role", "status", "createdAt" } ] }
403 -> caller is not an active director

POST /api/org-members   { "action", "email", "role"? }   (director-only)
  action = "add" | "approve" | "remove" | "set-role"
  -> 204 | 400 (last director / unknown action) | 404 (not in this org)
```

```
GET    /api/org-prompts                                                   (any active member)
200 -> { "org": { "name" }, "tabs": [ { "id", "name", "emoji", "sort_order" } ],
        "prompts": [ { "id", "name", "prompt_text", "type", "tab_id", "sort_order" } ] }

POST   /api/org-prompts        { "name", "promptText", "type", "tabId"? }  (director-only) -> 201
PATCH  /api/org-prompts/:id    { "name"?, "promptText"?, "type"?, "tabId"? }  (director-only) -> 204 | 404
DELETE /api/org-prompts/:id                                               (director-only) -> 204 | 404
```

```
POST   /api/org-tabs             { "name", "emoji"? }                     (director-only) -> 201
POST   /api/org-tabs             { "action": "reorder", "orderedIds" }    (director-only) -> 204
PATCH  /api/org-tabs?id=<id>     { "name"?, "emoji"? }                    (director-only) -> 204 | 404
DELETE /api/org-tabs?id=<id>                                             (director-only) -> 204 | 400 (last tab) | 404
  -- the deleted tab's prompts move to the org's first remaining tab.
```

```
POST /api/prompt-run   { "promptId": "..." }                             (any active member) -> 204 | 404
  -- bumps the (prompt, member) lifetime counter and today's org-wide total.

GET  /api/org-analytics                                                  (director-only)
200 -> { "topPrompts": [ { "promptId", "name", "runCount" } ],
         "perMember":  [ { "email", "runCount", "lastUsedAt" } ],
         "dailyRuns":  [ { "day", "runCount" } ] }   // last 30 days
```

```
POST /api/usage-report
Authorization: Bearer <token>
Body: { "sessionPercent": number | null, "weeklyPercent": number | null, "spendPercent": number | null }
204 -> accepted
403 -> caller is not an active organization member

GET /api/org-usage   (director-only)
Authorization: Bearer <token>
200 -> { "snapshots": [ { "email", "sessionPercent", "weeklyPercent", "spendPercent", "updatedAt" } ] }
```
