# Phase 2D: Organization Roles, Membership & Prompt Management Design

Date: 2026-08-19
Status: Approved

## Context

Phase 2C (Google sign-in + a read-only Team section) is merged. It
deliberately deferred two things, both named explicitly in the Phase 2
spec's "out of scope" list: an admin publishing UI for org prompts (today
seeded only by hand via direct SQL), and real membership verification
beyond email-domain matching. This document designs both, plus a slice of
Phase 3 (usage) pulled forward at the user's request: reporting each
member's existing usage-percentage meters while they're active in an
organization, visible to that org's directors.

This is intentionally still not the full end-state vision (enterprise SSO
federation, full usage history/trends, and true token-count analytics all
remain future work) — it's the next minimal, coherent slice.

## Goals of this slice

- Real, persisted org membership with two roles: **director** and
  **member**.
- The first person to sign in for an organization creates it (choosing its
  name) and becomes its director. Everyone signing in after that either
  auto-joins as a pending member (real company domains) or creates their
  own separate new organization (public/consumer domains).
- Directors can approve or remove members, add a member directly by email
  (works across any domain, skips the pending queue), and
  promote/demote members ↔ directors — with a server-enforced guard so an
  organization can never end up with zero directors.
- Directors get full CRUD (add, edit, delete) on their organization's
  prompts, through the extension UI — replacing today's direct-SQL-only
  seeding.
- While a member has an **active** (approved, non-pending) organization
  session live, the extension periodically reports their existing
  usage-percentage meters (session/weekly/spend %) to the backend.
  Directors see the latest snapshot per member. Reporting stops the
  instant the session isn't active — signed out, still pending, or never
  signed in.

## Explicitly out of scope for this slice

- **A separate "Personal" sign-in flow.** Personal buttons already work
  today with zero sign-in — there is nothing a distinct Personal sign-in
  would unlock that isn't already true. The only sign-in button is "Sign
  in with your organisation."
- **True token-count usage.** No API available to this extension exposes
  real per-message or per-conversation token counts. What's tracked is
  claude.ai's own account-level rate-limit percentages — the same numbers
  `usage.ts` already parses for personal display — not a token number.
- **Usage history/trends.** Only the latest snapshot per member is stored,
  not a time series. A history view is a natural additive follow-on.
- **A member-facing membership roster.** Only directors can see who else
  is in the organization; regular members have no visibility into the
  roster in this slice.
- **Rate limiting** on the new write endpoints (add-member, usage-report,
  prompt CRUD). Flagged as follow-up hardening, not blocking this slice.
- **Chrome Web Store publishing itself.** A real prerequisite for "anyone
  can just download this," but a separate, parallel workstream — not
  designed here. Worth noting one consequence for whenever that happens:
  the extension's ID (and therefore its OAuth redirect URI) changes
  between an unpacked dev build and a Store-published listing, so the
  `redirect_uri_mismatch` remediation done for Phase 2C will need
  repeating once, against the Store-assigned ID.
- **Resolving an email that belongs to more than one organization.**
  Add-by-email works across any domain, so a person could legitimately end
  up an `org_members` row in two organizations. Which one the extension
  shows is not decided in this document — left for the implementation plan
  to pick a simple default (e.g. most-recently-active membership).

## Architecture

### Data model

Two new tables, following the existing `organizations`/`prompts` schema's
conventions (UUID primary keys, Postgres Row Level Security scoped to
`org_id`):

```sql
create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null,
  role text not null check (role in ('director', 'member')),
  status text not null check (status in ('pending', 'active')),
  invited_by text,  -- a director's email; null when created via domain auto-join
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

alter table org_members enable row level security;
alter table org_members force row level security;

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
```

`usage_snapshots` stores one row per member — each report **upserts**,
overwriting the previous value. No history table in this slice.

**Schema change to `organizations`:** `domain` drops its `unique`
constraint. Real company domains still get "one organization per domain"
in practice (enforced at the application layer at creation time, described
below), but public/consumer domains (`gmail.com`, `outlook.com`, etc.)
will legitimately have many unrelated organizations all recording the same
`domain` value — a unique constraint would make that impossible.

### Public-domain list

A hardcoded array in the backend (not a database table — this is a
maintained constant, matching the project's existing preference for
minimal moving parts): `gmail.com`, `googlemail.com`, `outlook.com`,
`hotmail.com`, `live.com`, `yahoo.com`, `icloud.com`, `aol.com`,
`protonmail.com`, `gmx.com`, and similar major providers. This list
governs one thing only: whether domain-based auto-join applies. It no
longer blocks anyone from creating an organization — see the sign-in flow
below.

### Sign-in / organization-resolution flow

Replaces Phase 2C's implicit "org derived from domain on every request"
model with an explicit resolution step, run once right after a successful
Google sign-in:

```
POST /api/org-session
Authorization: Bearer <google-id-token>

200 -> { "state": "active", "org": { "id": "...", "name": "...", "role": "director" | "member" } }
200 -> { "state": "pending", "org": { "id": "...", "name": "..." } }
200 -> { "state": "needs_onboarding" }
401 -> token missing/invalid
```

Resolution order, run server-side against the verified token's email:

1. **An `org_members` row already exists for this exact email** (from an
   earlier sign-in, or a director having added them) → return its current
   `org_id`/`status`/`role` as-is. This branch also covers a member who
   was previously removed and is signing in again: their row was deleted
   on removal, so they fall through to step 2 or 3 exactly like a
   first-time signer — landing back in the pending queue for their
   domain's org if one exists, per the user's explicit choice not to build
   a permanent-ban state this slice.
2. **No existing row, but the email's domain matches an existing
   organization's `domain`, and that domain is not on the public-provider
   list** → create a new `org_members` row (`role: member`,
   `status: pending`), return `state: pending`.
3. **Otherwise** (no existing row, and either no organization exists yet
   for this domain, or the domain is a public/consumer one) → return
   `state: needs_onboarding`. The extension shows a short "Set up your
   organization" screen: choose an organization name, optionally add
   initial member emails right there.

```
POST /api/org-onboarding
Authorization: Bearer <google-id-token>
Body: { "orgName": "...", "initialMemberEmails": ["...", "..."] }

200 -> { "org": { "id": "...", "name": "...", "role": "director" } }
```

Creates the `organizations` row (`domain` = the caller's email domain, for
display and future domain-matching only — not unique), an `org_members`
row for the caller (`role: director`, `status: active`), and one
`org_members` row per submitted email (`role: member`, `status: active`,
`invited_by`: the caller's email).

**Race condition, handled without surfacing an error:** two people from
the same brand-new real company domain could both hit `needs_onboarding`
and submit onboarding within the same window. The second `insert` on
`organizations` (application-level uniqueness check for non-public
domains, not a DB constraint) detects the domain now has an owner; instead
of erroring, that second submission is converted into joining the
just-created organization as a pending member, and their onboarding
request that would have made them a second director is discarded.

### Membership management endpoints (director-only)

Every endpoint below checks the caller's own `org_members` row
(`role: director`, `status: active`, matching their verified token email)
before doing anything, returning `403` otherwise.

```
GET  /api/org-members                          -> list of { email, role, status, createdAt }
POST /api/org-members/approve   { email }       -> sets status: active
POST /api/org-members/remove    { email }       -> deletes the row
POST /api/org-members/add       { email }       -> creates/upserts an active member row (any domain)
POST /api/org-members/set-role  { email, role }  -> updates role
```

**Last-director guard**, enforced in `remove` and `set-role`: before
demoting or removing a `director`/`active` row, count remaining
`director`/`active` rows for that `org_id`. If the count would drop to
zero, reject with a clear error. This is checked server-side on every such
request, not only in the UI — closing the "org with no one who can manage
it" gap identified during design, rather than leaving it as an accepted
limitation.

A director can call `approve` on a row that's already promoted via
`set-role` before approval — promoting a pending member directly to
director implies approving them; the extension's UI exposes this as one
action, not two separate clicks.

### Org prompt management endpoints (director-only)

```
POST   /api/org-prompts        { name, promptText, type }        -> creates a prompt
PATCH  /api/org-prompts/:id    { name?, promptText?, type? }      -> edits a prompt
DELETE /api/org-prompts/:id                                       -> deletes a prompt
```

Same director-only check as membership endpoints. `GET /api/org-prompts`
(Phase 2C, unchanged) stays available to any active member, read-only.

### Usage reporting

```
POST /api/usage-report
Authorization: Bearer <google-id-token>
Body: { "sessionPercent": number | null, "weeklyPercent": number | null, "spendPercent": number | null }

204 -> accepted
403 -> caller's org_members status isn't "active"
```

The extension calls this only while the signed-in member's organization
session is `active` — never while `pending`, never while signed out. The
exact reporting cadence (on sidebar open, plus a periodic interval while
it stays open) is an implementation-plan detail, not fixed by this design.

```
GET /api/org-usage   (director-only)
-> [ { email, sessionPercent, weeklyPercent, spendPercent, updatedAt } ]
```

### Extension changes

- **Settings panel:** the existing sign-in control becomes "Sign in with
  your organisation" (single button, replacing today's generic wording).
- **New onboarding view:** shown when `POST /api/org-session` returns
  `needs_onboarding` — an organization-name field and an optional list of
  emails to add immediately.
- **Pending state:** shown when `state: pending` — "You're signed in.
  Waiting for a director to approve you." Personal buttons remain fully
  usable regardless of this state, unchanged from Phase 2C.
- **New "Manage Organisation" view**, reachable from Settings only when
  the signed-in member's role is `director`: the member roster
  (active + pending, with approve/remove/promote/demote actions and an
  add-by-email field), prompt management (add/edit/delete forms), and the
  usage table (latest per-member snapshot).
- **Team section:** unchanged from Phase 2C for regular members — still
  read-only, run-only.
- **Usage reporting:** a new periodic call to `POST /api/usage-report`
  while the org session is active, reusing the same usage-percentage
  values already computed by `usage.ts` for personal display.

## Non-functional requirements

- **Least data collected, still true.** Usage data is the one new category
  of data this slice collects, and it's scoped as tightly as the user
  requested: only while a member's organization session is active, never
  while pending or signed out, and only the latest snapshot is kept, not a
  history.
- **Director-only actions enforced server-side**, not just hidden in the
  UI — every membership, role-change, and prompt-write endpoint
  independently re-checks the caller's role and status from their verified
  token on every request.
- **Isolation still enforced at the database layer.** `org_members` and
  `usage_snapshots` get the same Row Level Security treatment as
  `prompts` — a bug in an API handler's query can't leak one
  organization's membership or usage data into another's.
- **Known, accepted gap: a removed member can freely re-request access.**
  Removing someone deletes their `org_members` row; if they sign in again,
  they land back in the pending queue like anyone else, and a director has
  to reject them again. No permanent-ban state exists in this slice — an
  explicit choice, not an oversight, made to keep the model simple; worth
  revisiting if abuse becomes a real problem.
- **Known, accepted gap: usage data reflects whichever claude.ai account
  is logged into the browser**, which is a separate authentication system
  from the extension's own organization sign-in. A member could in
  principle be signed into the organization with their work Google account
  while claude.ai itself is logged into an unrelated account, producing
  usage numbers that don't represent their organizational activity. Not
  solved in this slice.
- **Privacy note for whoever operates an organization:** a director seeing
  each member's own usage percentages is more sensitive than an aggregate
  number. This slice shows per-member data, as requested — worth being
  explicit about that with any real organization's members before this
  ships to them.

## Testing

- **Backend:** the resolution-order logic in `POST /api/org-session`
  (known member / domain auto-join / needs onboarding) and the
  last-director guard are pure enough to unit test against fixture rows,
  same pattern as the existing `org-prompts.ts` verification tests.
- **Extension:** any new pure parsing/shaping logic (e.g. shaping the
  member-list or usage-snapshot API responses for rendering) gets the same
  TDD treatment as `org-prompts.ts`. The onboarding form, Manage
  Organisation view, and usage-reporting timer are manual-verification-only,
  matching this project's established convention for `chrome.identity`/DOM/
  timer-driven UI work.

## Path toward the full vision

- **Membership verification** (the Phase 2 spec's "known, accepted gap")
  is substantially closed by this slice: real persisted membership with an
  approval step, rather than pure domain matching. What remains open is
  the removed-member re-request gap noted above.
- **Admin publishing UI** (also named explicitly in Phase 2's deferred
  list) is delivered here in full for prompts.
- **Usage analytics (Phase 3):** this slice delivers the account-level
  percentage-meter piece specifically, scoped to organizations. Full
  Phase 3 — real token-level analytics, prompt-run history, trends over
  time — still depends on work this slice deliberately doesn't attempt:
  no API exists yet to source real token counts, and no history table is
  introduced here. The `usage_snapshots` table's shape (keyed on
  `org_id`/`email`) is a reasonable foundation for a future
  `usage_history` table to attach to without redesigning this slice.
