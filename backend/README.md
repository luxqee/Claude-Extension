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
