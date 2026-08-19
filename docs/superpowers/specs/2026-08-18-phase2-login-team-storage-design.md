# Phase 2: Company Login + Centralized Prompt Storage (Minimal Slice) Design

Date: 2026-08-18
Status: Approved

## Context

Stage 1 (the extension's core: buttons, storage, insertion into claude.ai,
skills, styling) is complete and merged. A separate exploratory pass
(`docs/stage2-considerations.md`, not committed — see that file locally)
identified three follow-on areas: a personal usage indicator (Phase 1,
designed and approved separately, not yet spec'd/planned), company
login + centralized prompt storage (**Phase 2 — this document**), and
usage/prompt analytics (Phase 3, which depends on both earlier phases).

This document is deliberately the **minimal first slice** of Phase 2, not
the full end-state vision. The full vision — an admin UI for publishing
prompts, enterprise SSO federation to arbitrary identity providers,
offline sync, and org-wide analytics — is the explicit near-term goal
this slice is built toward, so every piece here is designed with a clear,
already-identified extension point rather than a dead end. See "Path
toward the full vision" at the end of this document.

## Goals of this slice

- A user can sign in with their Google account from the sidebar.
- Their email domain determines which company/org they belong to.
- They see a read-only list of that org's shared prompts and skills,
  alongside their existing personal (local) buttons — both coexist.
- Org data is centrally stored (Neon Postgres) and isolated per company.

## Explicitly out of scope for this slice

Deferred to named follow-on phases, not forgotten:

- **Admin publishing UI.** An org's shared prompts are seeded directly in
  the database for now, not through any UI.
- **Enterprise SSO federation** (Okta, Azure AD, arbitrary SAML/OIDC
  providers). This slice is Google sign-in only; the auth layer is built
  behind an interface specifically so a broker (WorkOS or Auth0) can
  implement enterprise federation later without touching the UI.
- **Offline sync.** The extension caches the last-fetched org prompts
  locally so a network hiccup doesn't blank the list, but there's no
  write-while-offline story — this slice has no writes from the
  extension at all.
- **Usage analytics** (token, prompt, skill, button). This is Phase 3,
  and depends on both this phase's org/login model and Phase 1's
  usage-endpoint work.
- **Membership verification beyond email domain.** See the NFR section
  below — this is a known, accepted gap for this slice, not an oversight.

## Architecture

### Components

**Neon Postgres** — the database, chosen because the team already has
Postgres experience, and its Row Level Security feature (native to
Postgres, not vendor-specific) gives real database-level multi-tenant
isolation. Two tables for this slice:

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique  -- e.g. 'acme.com', matched against signed-in users' email domains
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
-- policy: a request may only read prompts where org_id matches the org
-- resolved from its verified token's email domain (enforced in the API
-- layer's query, using a scoped Postgres role/session variable per request)
```

No `users` table in this slice — org membership is derived per-request
from the verified Google token's email domain, not persisted. This keeps
the slice minimal; a `users`/`org_members` table is a natural, additive
follow-on once real membership approval (invite/accept) matters (see
NFRs below).

**A small serverless API layer** (Cloudflare Workers or Vercel
functions — no server to run or patch, matching this project's existing
preference for minimal ops surface). One endpoint:

```
GET /api/org-prompts
Authorization: Bearer <google-id-token>

200 -> { "org": { "name": "Acme" }, "prompts": [ { "name": "...", "prompt_text": "...", "type": "prompt" } ] }
200 -> { "org": null, "prompts": [] }   // token verifies, but no org matches the domain yet
401 -> token missing/invalid
```

The endpoint verifies the Google ID token (standard JWT verification
against Google's published signing keys — no network round-trip to
Google needed once the keys are cached), extracts the verified email,
derives the domain, looks up the matching `organizations` row, and
returns its prompts. No write endpoint exists in this slice.

**Extension changes:**

- **`src/shared/auth/`** (new) — an `AuthAdapter` interface, mirroring
  the existing `StorageAdapter` pattern at
  `src/shared/storage/storage-adapter.ts`:

  ```ts
  export interface AuthAdapter {
    signIn(): Promise<{ email: string; idToken: string } | null>
    signOut(): Promise<void>
    getCurrentSession(): Promise<{ email: string } | null>
  }
  ```

  This slice implements `GoogleAuthAdapter`, using
  `chrome.identity.launchWebAuthFlow()` with `response_type=id_token`.
  **Correction (2026-08-19, before Phase 2C implementation):** this spec
  originally named `chrome.identity.getAuthToken()` for this purpose.
  That was wrong — `getAuthToken()` returns an OAuth *access* token, not
  an ID token, and the backend's `verifyIdToken()` (already built and
  reviewed in Phase 2B) specifically requires a signed ID token (JWT).
  `launchWebAuthFlow()`, given an explicit `response_type=id_token` in
  the authorization URL, is the mechanism that actually returns one.
  This keeps the already-hardened backend unchanged; only the
  extension-side token acquisition differs from what was originally
  written here. A future `WorkOSAuthAdapter` (or similar) implements the
  same `AuthAdapter` interface for enterprise federation, without any
  change to the UI layer that consumes it.

- **`src/shared/org-prompts.ts`** (new) — a read-only counterpart to
  `ToolService`, fetching and caching the org's prompt list. Deliberately
  a separate module from `ToolService`/`StorageAdapter` rather than
  folded into them, since org prompts have a different shape and
  lifecycle (no create/update/delete/reorder from the extension in this
  slice) — forcing them into the personal-button interface would mean
  stubbing out mutation methods that don't apply.

- **Settings panel** gains a Sign in / Sign out control (same location
  as the existing Export/Import actions).

- **Sidebar** shows personal buttons exactly as today, plus — only when
  signed in and the org has prompts — a separate "Team" section below
  them: same button-row visual language, but read-only (no edit,
  delete, or drag handle on those rows).

### Data flow

1. User clicks "Sign in" in Settings.
2. `GoogleAuthAdapter.signIn()` obtains a Google ID token via
   `chrome.identity.launchWebAuthFlow()` (see the correction above).
3. The extension calls `GET /api/org-prompts` with that token.
4. The API verifies the token, resolves the org from the email domain,
   and returns its prompts (an empty list if no org matches yet — this
   is an expected state, not an error).
5. The extension caches the result in `chrome.storage.local` and renders
   the Team section. On later loads, it re-fetches but falls back to the
   cached copy if the request fails.

### Error handling

- **No matching org for the domain** → a neutral "Team prompts aren't
  set up for your organization yet" state, not an error.
- **Network/API failure** → fall back to the last cached org prompts if
  any exist; otherwise the Team section simply doesn't render. Personal
  buttons are never affected by anything in this section.
- **Expired/invalid Google token** → silently retry
  `chrome.identity.getAuthToken()` (its normal refresh path); only
  surface a "Sign in again" prompt if that fails outright.

## Non-functional requirements

Carried forward from the earlier considerations doc, made concrete for
this specific slice:

- **No secrets in the extension bundle.** The extension never holds a
  database credential or API secret — only the signed-in user's own
  Google ID token, which is short-lived and scoped to their identity,
  not a service credential. The Postgres connection string and any API
  secrets live only in the serverless functions' environment, never
  shipped to the client.
- **Encrypted transport.** The API is HTTPS-only (default for both
  Cloudflare Workers and Vercel).
- **Isolation enforced at the database layer**, not just in application
  code — Postgres Row Level Security on `org_id`, so a bug in the API's
  query logic can't leak one company's prompts to another. Defense in
  depth, not reliance on a single correct `WHERE` clause.
- **Least data collected.** This slice stores org name/domain and prompt
  text only — no usage logging, no prompt-run history, no analytics of
  any kind yet. That's Phase 3, deliberately not pulled forward.
- **Known, accepted gap: domain-matching is not membership verification.**
  Matching org membership purely by email domain is a reasonable
  heuristic for a first slice with manually-seeded, low-stakes shared
  prompts — but it is not proof of authorized employment, and must not
  be treated as sufficient once this handles anything sensitive. A real
  invite/approve membership flow is required before this NFR gap can be
  considered closed; it's tracked here explicitly rather than silently
  accepted as permanent.
- **Privacy policy staleness.** The current README's "no data leaves
  your browser" claim becomes false the moment this slice ships. That
  claim needs a follow-up correction as part of shipping this, not
  bundled into this design doc's own scope.
- **Chrome Web Store implications.** This adds a new `host_permissions`
  entry (the API's domain), which needs justification in the store
  listing. No part of this design fetches or executes remote code — the
  API returns JSON data only — so the Store's "no remotely-loaded code"
  policy is satisfied by construction, not by care taken during
  implementation.

## Testing

- **API layer:** token verification and org-lookup are pure enough to
  unit test in isolation — given a verified token payload, does the
  right org (or `null`) come back.
- **Extension side:** `GoogleAuthAdapter` and `org-prompts.ts` follow the
  same TDD pattern already established for `StorageAdapter`/
  `ToolService`, with tests in `tests/shared/`. The Settings sign-in
  control and the Team section's rendering are manual-verification-only,
  matching every other UI piece in this project.

## Path toward the full vision

This slice's shape isn't a placeholder to be reworked — it's the actual
foundation the fuller vision builds on directly:

- **Auth:** `AuthAdapter` today with `GoogleAuthAdapter` → add
  `WorkOSAuthAdapter` for enterprise federation later. UI code never
  changes.
- **Publishing:** today's direct-database seeding → a real admin
  publish UI is additive — new write endpoints against the same
  `organizations`/`prompts` tables, no schema rework.
- **Analytics (Phase 3):** this slice's org/prompt model is exactly what
  usage analytics attaches to — a new `prompt_runs` table referencing
  the same org and prompt IDs records who ran what and when, without
  redesigning anything built here. Token-usage analytics specifically
  still depends on Phase 1's usage-endpoint work landing first, per the
  original roadmap sequencing (usage indicator → login/team storage →
  analytics).
