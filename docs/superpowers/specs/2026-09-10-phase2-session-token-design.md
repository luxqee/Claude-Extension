# Phase 2: Multi-Device Sign-In & Backend Session Token Design

Date: 2026-09-10
Status: Draft — awaiting review

## Context

The extension is being handed to several testers, each on their own
machine. The worry driving this phase was "OAuth needs reconfiguring for
every new device." The Phase 1 audit found that is **mostly already
solved**: `manifest.config.ts` pins the extension ID via its `key` field,
so every unpacked build of this repo has the same ID
(`fhaeedmmhjjkhnopifppigddjbbmdegh`), the same
`https://<id>.chromiumapp.org/` redirect URI, and therefore the same
single Google Cloud redirect-URI registration. A `redirect_uri_mismatch`
should not recur once that URI is registered, regardless of machine.

What actually blocks a spread-out group of testers is different:

1. **OAuth consent-screen publishing status.** If the Google Cloud
   project's OAuth consent screen is still in **Testing**, only emails
   explicitly added as test users can sign in at all — everyone else gets
   `access_denied` — and issued tokens expire faster. The scopes in use
   (`openid`, `email`) are non-sensitive, so moving the consent screen to
   **In production** needs no Google review and takes effect immediately.
2. **Frequent silent re-auth.** Today the extension stores the Google
   `id_token` directly and calls `chrome.identity.launchWebAuthFlow` in
   non-interactive mode to refresh it whenever it nears expiry (~1 hour).
   That silent refresh depends on a live Google session in the browser
   and on third-party-cookie behaviour that Chrome is progressively
   restricting. Under consent-screen Testing mode the underlying grant
   also expires after ~7 days, forcing a full interactive sign-in.
3. **Old builds.** A tester who loaded a pre-`key` build has a different
   extension ID and will hit `redirect_uri_mismatch`. Remedy is
   procedural: everyone rebuilds from current `main`.

This phase keeps the existing Google sign-in flow unchanged and adds a
backend-issued **session token** the extension uses for all subsequent
API calls, so day-to-day operation no longer depends on refreshing a
short-lived Google `id_token`.

## Decisions locked with the user

- **Keep the current `launchWebAuthFlow` implicit `id_token` flow** for
  the initial sign-in. Add a backend session token on top; do not switch
  to `chrome.identity.getAuthToken` or a redirect-based code flow.
- **Backend URL stays** `https://claude-extension-git-main-luxqees-projects.vercel.app`.
  Not changed this phase.
- The consent-screen publishing status is **unknown**; the user will
  check it and report back. This spec covers both outcomes.

## Explicitly out of scope

- **Token revocation / a session-token denylist.** Not needed: every
  org endpoint already re-checks the caller's `org_members` row on every
  request, so a removed or demoted member loses org access immediately
  regardless of how long their session token remains cryptographically
  valid. Personal features touch no server. Session-token lifetime is
  kept modest (14 days) to bound the residual risk.
- **Switching auth providers or adding SSO.**
- **Chrome Web Store publishing.** Still a separate workstream. Note the
  standing consequence: a Store listing gets a different extension ID, so
  the redirect URI must be re-registered once against that ID.
- **Rate limiting** on the new `/api/auth/session` endpoint. Consistent
  with the other write endpoints; flagged as follow-up hardening.
- Any change to the personal-buttons storage or UI. That is Phase 3+.

## Architecture

### New endpoint: `POST /api/auth/session`

```
POST /api/auth/session
Authorization: Bearer <google-id-token>

200 -> { "sessionToken": "<jwt>", "email": "a@b.com", "expiresAt": "<ISO-8601>" }
401 -> Google id_token missing or invalid
```

Verifies the Google `id_token` exactly as the other endpoints do today
(`OAuth2Client.verifyIdToken`, `email_verified` required), then issues a
signed JWT:

- Algorithm **HS256**, secret from a new environment variable
  `SESSION_JWT_SECRET` (Vercel project settings, never shipped in the
  extension).
- Claims: `{ sub: <email>, email: <email>, iat, exp }`, `exp` = now + 14
  days.
- Signed and verified with Node's built-in `node:crypto` HMAC — a small
  hand-rolled encode/verify pair (~40 lines), matching this project's
  established preference for a maintained constant over a new dependency
  (cf. the hardcoded public-domain list). `jose` is the fallback if a
  verification edge case makes the hand-roll not worth it; the decision
  is recorded in the implementation plan, not here.

### New shared helper: `backend/lib/resolve-email.ts`

```ts
resolveEmail(authorizationHeader: string | undefined): Promise<string | null>
```

Resolution order:

1. No `Bearer ` prefix → `null`.
2. Try to verify the token as a **session JWT** with `SESSION_JWT_SECRET`
   (no network call). Valid and unexpired → return its `email` claim.
3. Otherwise fall back to Google `verifyIdToken` (the current path).
   Valid and `email_verified` → return `payload.email`.
4. Neither → `null`.

Every existing endpoint replaces its private `verifyEmail()` /
`verifyIdToken` block with a call to this helper. Nothing downstream
changes: `resolveDirectorContext`, `resolveSessionState`, the RLS
`set_config('app.current_org_id', ...)` calls, and all role/status checks
already key off the resolved email string alone.

Endpoints touched (all currently inline the same ~10-line verify block):
`org-session`, `org-onboarding`, `org-prompts`, `org-prompts/[id]`,
`org-members`, `org-members-add`, `org-members-approve`,
`org-members-remove`, `org-members-set-role`, `org-usage`,
`usage-report`.

### Extension changes

**`src/shared/auth/` — session-token storage and use.**

- After a successful Google sign-in, immediately `POST /api/auth/session`
  with the fresh `id_token` and store
  `{ email, sessionToken, sessionExpiresAt }` under the existing
  `authSession` storage key (shape extended, not renamed).
- `GoogleAuthAdapter.getValidIdToken()` is renamed to `getValidToken()`
  (the returned string is what goes in the `Authorization: Bearer`
  header — callers are unaffected by what kind of token it is):
  - Session token present and more than a small skew from `expiresAt` →
    return it. No network, no Google session dependency.
  - Session token missing or near expiry → run the existing silent
    `runAuthFlow(false)` to get a fresh Google `id_token`, exchange it at
    `/api/auth/session`, store and return the new session token.
  - Silent refresh fails outright → clear the stored session (unchanged
    from today) so `getCurrentSession()` reports signed-out.
- `AuthAdapter` interface: `getValidIdToken` → `getValidToken`. The one
  production implementation and the test double both update; call sites
  in `main.ts` change only in name.

**Back-compatibility.** A session stored by the current build is
`{ email, idToken }`. On the first `getValidToken()` after upgrade there
is no `sessionToken`, so the adapter takes the "near expiry" branch,
silently exchanges, and upgrades the stored shape. If the silent exchange
can't run (offline), endpoints still accept the raw Google `id_token`
via `resolveEmail` step 3, so nothing breaks in the meantime.

### Consent-screen remediation (procedural, documented not coded)

Added to `backend/README.md` and the root `README.md`:

- How to check **APIs & Services → OAuth consent screen → Publishing
  status**.
- If **Testing**: either add every tester's email under *Test users*, or
  click **Publish app** to move to *In production* (no review required
  for `openid`/`email`; recommended for a tester group of any size).
- The single redirect URI
  `https://fhaeedmmhjjkhnopifppigddjbbmdegh.chromiumapp.org/` and that it
  is machine-independent because the extension ID is pinned.

## Security review

- **Server stays authoritative.** `resolveEmail` returns only an email,
  derived either from a Google-verified `id_token` or from a JWT this
  backend itself signed. `orgId`, `role`, `isAdmin`, membership status
  are never read from the request — unchanged from today.
- **Session-JWT secret** lives only in Vercel env; the extension never
  sees it and cannot mint tokens.
- **Tampering** with a session JWT fails the HMAC check → falls through
  to Google verification → fails that too → `null` → `401`.
- **Expiry** is enforced on every call (`exp` claim checked in step 2).
- **A removed/demoted member** holding a still-valid session token gains
  nothing: `resolveDirectorContext` and the `org_members` status checks
  run per request and now return no row / `member`.
- **No new PII** is stored. The JWT holds only the email already handled
  everywhere in the system.
- **`SESSION_JWT_SECRET` absent in an environment** → `/api/auth/session`
  returns `500` and `resolveEmail` step 2 is skipped (treated as "not a
  session token"), so the system degrades to today's Google-only
  behaviour rather than failing open.

## Testing

**Backend (automated, Vitest — pure logic, fixture-based, matching the
existing `resolve-session.test.ts` pattern):**

- JWT encode→verify round-trip: valid token resolves to its email.
- Tampered payload / signature → rejected.
- Expired `exp` → rejected.
- Wrong secret → rejected.
- `resolveEmail`: session-JWT path, Google-fallback path (mocked
  `OAuth2Client`), missing header, malformed header, both-invalid.

**Extension (automated where pure):**

- `getValidToken()` branch logic with a fake storage adapter and a
  stubbed exchange call: fresh session token returned as-is; near-expiry
  triggers exchange; legacy `{ email, idToken }` upgrades on first call;
  failed silent refresh clears the session.

**Manual matrix (documented in the phase's plan, run in real Chrome):**

| Case | Expected |
|---|---|
| Device A / B / C, same Google account, current build | sign-in works on each with no per-device config |
| Different Google account | independent sign-in, its own org resolution |
| Admin sign-in | Manage Organisation visible, all actions work |
| Member sign-in | Team section only, no admin controls |
| Pending member | pending banner, personal buttons still work |
| Removed member, then API call | `403`, org UI drops |
| Session token expired (force by editing stored `expiresAt`) | silent exchange, call succeeds |
| Session token tampered | `401`, then recovery on next clean sign-in |
| Sign out | stored session cleared, org UI gone, usage reporting stops |
| Sign in again | works, new session token issued |
| Offline, valid stored session token | org reads from cache, no crash |

## Rollout

1. Merge backend first (new endpoint + `resolveEmail` accepting **both**
   token kinds). Existing extension builds keep working — they still send
   Google `id_token`s, which step 3 accepts.
2. Set `SESSION_JWT_SECRET` in Vercel before/at deploy.
3. Merge the extension change; testers rebuild from `main` and reload.
4. Confirm the consent-screen status and apply the README remediation.

No database migration in this phase.
