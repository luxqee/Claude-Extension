# AIRE Extension

A Chrome extension that adds a sidebar of configurable buttons to
[claude.ai](https://claude.ai). Each button holds a saved prompt or a
skill invocation; clicking it types that text into Claude's chat box so
you can review (and edit) it before sending — **nothing is ever sent
automatically**.

- **Personal buttons** work with zero sign-in, zero backend, zero data
  leaving your browser (`chrome.storage.local`).
- **Organisations** (optional): sign in to unlock a shared, admin-managed
  prompt list, membership, and usage/analytics for admins. This part
  talks to a hosted backend — see [Organisations](#organisations).

---

## For testers — get it running

You need **Node.js 20 or 22 LTS** and **pnpm 9+**. Node 24 currently
breaks pnpm's pre-run step on some machines; stick to an LTS release.

```bash
git clone https://github.com/luxqee/Claude-Extension.git
cd Claude-Extension
pnpm install
pnpm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the **`dist/`** folder (not the repo root)

Open a claude.ai tab and click the extension's toolbar icon to open the
sidebar. After any later `pnpm run build`, click the reload icon on the
extension's card in `chrome://extensions`.

That's the whole tester setup. You do **not** register anything, create
any account, deploy anything, or edit any config. Organisation sign-in
uses a backend that is already deployed and shared by all testers.

**Prerequisites, if you don't have them:**

- **macOS:** `brew install node@22 pnpm git`
- **Windows:** install [Node.js 22 LTS](https://nodejs.org), then
  `corepack enable` (or `npm install -g pnpm`). Git ships with
  [Git for Windows](https://git-scm.com/download/win).
- **Linux:** install Node 22 from your distro or
  [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22`), then
  `corepack enable`.

### If organisation sign-in fails

Personal buttons still work regardless. If **sign-in itself** errors:

- `redirect_uri_mismatch` or `access_denied` → this is a **one-time
  developer setup** item that hasn't been done (or the Google consent
  screen is still in "Testing" mode). It is not something a tester can
  fix. Tell the developer. See
  [For the developer](#for-the-developer--one-time-setup).
- "Reload the Claude tab and try again" → reload the claude.ai tab (the
  content script only injects into tabs opened *after* the extension was
  loaded/reloaded), then retry.

---

## For the developer — one-time setup

Do these **once**. After that, any number of testers on any number of
machines can clone-build-run with no further per-tester work, because the
extension ID is pinned (`key` in `manifest.config.ts`) so every build has
the same ID and the same single OAuth redirect URI.

### 1. Backend (Vercel + Neon)

1. Create a **Neon** Postgres database. Run `backend/schema.sql` against
   it once (Neon SQL Editor, or `psql "$DATABASE_URL" -f backend/schema.sql`).
   The `DATABASE_URL` role must be a plain non-superuser without
   `BYPASSRLS`, or row-level security is silently defeated.
2. Create a **Vercel** project from this repo with **Root Directory =
   `backend`**. It deploys on every push to `main`.
3. Set these environment variables in the Vercel project
   (Settings → Environment Variables):

   | Variable | Required | Value |
   |---|---|---|
   | `DATABASE_URL` | yes | Neon connection string |
   | `SESSION_JWT_SECRET` | yes | `openssl rand -hex 32` — signs 14-day session tokens |
   | `GOOGLE_OAUTH_CLIENT_ID` | for Google sign-in | same client ID as in `src/shared/auth/providers.ts` |
   | `CLERK_ISSUER` | for Clerk sign-in | e.g. `https://your-instance.clerk.accounts.dev` |
   | `CLERK_OAUTH_CLIENT_ID` | for Clerk sign-in | from Clerk → OAuth Applications |
   | `CLERK_OAUTH_CLIENT_SECRET` | only if the Clerk OAuth app is confidential | from the same place |

4. Put the deployed URL in **`src/shared/api-base.ts`** (`API_BASE_URL`)
   and in `host_permissions` in `manifest.config.ts`. Commit. Testers
   build from this, so their extension points at your backend.

### 2. Google sign-in

1. Google Cloud Console → **APIs & Services → Credentials** → create an
   **OAuth 2.0 Client ID** (Web application).
2. Add the redirect URI (exact, note the trailing slash):
   ```
   https://fhaeedmmhjjkhnopifppigddjbbmdegh.chromiumapp.org/
   ```
   This is the pinned extension ID — it never changes between machines,
   so this URI is added **once, ever**.
3. Put the client ID in `src/shared/auth/providers.ts` (`GOOGLE_CLIENT_ID`)
   and in Vercel as `GOOGLE_OAUTH_CLIENT_ID`.
4. **OAuth consent screen → Publishing status → Publish app.** The scopes
   used (`openid`, `email`) are non-sensitive, so publishing takes effect
   immediately with no Google review. While it stays in "Testing", only
   Google accounts you manually add under *Test users* can sign in — that
   is exactly the per-tester work this setup is meant to avoid, so
   publish.

### 3. Clerk sign-in (optional — adds SSO / Microsoft / GitHub / email)

1. Clerk Dashboard → **Configure → OAuth Applications → New application**.
   Scopes `openid email profile`. Redirect URI
   `https://fhaeedmmhjjkhnopifppigddjbbmdegh.chromiumapp.org/`. Public
   client (PKCE).
2. Copy the **Client ID** into `src/shared/auth/providers.ts`
   (`CLERK_OAUTH_CLIENT_ID`); set `CLERK_DOMAIN` there to your instance
   host. The Clerk button appears once both are filled.
3. Set `CLERK_ISSUER` (and `CLERK_OAUTH_CLIENT_SECRET` if the app is
   confidential) in Vercel. Add your instance host to `host_permissions`
   in `manifest.config.ts` if it differs from the default.
4. Enable the connections you want in the Clerk Dashboard (Social
   Connections, SSO Connections) — no code change.

### Secrets

Nothing secret lives in this repo. Client IDs and the public key in
`manifest.config.ts` are safe to commit. `SESSION_JWT_SECRET`,
`DATABASE_URL`, and any Clerk **secret** key live only in Vercel env
vars. There is no root `.env` file to create — if you have a stray
`.env.local` from earlier tooling, delete it (and rotate any key that was
in it).

---

## Using it

- **Add a button:** sidebar → **Add** → **Prompt** or **Skill** → name +
  text to insert. For a skill, the text is the slash-invocation itself
  (e.g. `/doc-summary`); claude.ai's own autocomplete takes over after
  insertion.
- **Run a button:** click its name — the text is typed into claude.ai's
  chat box and nothing else. You press Send.
- **Reorder:** drag a row by its handle, or focus it and use Arrow
  Up/Down.
- **Export / import:** Settings → Export writes a JSON file of all your
  buttons; Import merges buttons from a JSON file into your list. Old
  exports without a `type` import as Prompt.

---

## Organisations

Signing in is optional; personal buttons never need it. Signing in adds a
shared prompt list on top:

- **First sign-in at a company domain creates the organisation** and
  makes that person its **admin**. Later sign-ins from the same domain
  land in "waiting for approval" until an admin approves them.
- **Public email domains** (`gmail.com`, `outlook.com`, …) never
  auto-join — each such sign-in starts its own separate organisation.
- **Admins** get **Manage Organisation** in Settings: approve/remove
  members, add anyone by email, promote/demote admins, create/edit/delete
  shared prompts and tabs, and see per-member usage and prompt-run
  analytics. An organisation can never drop to zero admins.
- **Usage reporting:** while signed in, an approved member's
  session/weekly/spend percentages (the same numbers the personal usage
  widget shows) are reported periodically for admins to see. Stops on
  sign-out.

Every admin-only action is enforced **server-side**: the backend
re-derives the caller's email from their verified identity token and
re-checks their own membership row on every request. The client cannot
assert its own email, org, role, or admin status. Cross-organisation
isolation is enforced by Postgres row-level security
(`FORCE ROW LEVEL SECURITY`), not just by `WHERE` clauses.

---

## Development

```bash
pnpm install
pnpm run dev        # Vite dev build, watch mode
pnpm run build      # tsc --noEmit + production build to dist/
pnpm test           # Vitest (extension)
pnpm run typecheck  # tsc --noEmit only

cd backend && pnpm install && pnpm test && pnpm run typecheck
```

`build.mjs` is a pnpm-free fallback (`node build.mjs`) for machines where
the pnpm wrapper is broken; it runs the same `tsc` + `vite build`.

### Architecture

- **`src/background/service-worker.ts`** — enables the side panel only on
  claude.ai tabs.
- **`src/content/`** — content script for claude.ai. `claude-adapter.ts`
  finds the chat input and inserts text (never sends); `usage-widget.ts`
  renders the usage rings; `content-script.ts` wires messages from the
  sidebar and watches for an inserted prompt to actually be sent (for
  analytics).
- **`src/sidepanel/`** — the sidebar UI (vanilla TS + DOM). Button list,
  add/edit form, drag-and-drop, tabs, settings, and the organisation
  views. `render.ts` rebuilds the DOM per state; `main.ts` is the
  controller.
- **`src/shared/`** — shared model and services: `StorageAdapter` /
  `ToolService` (button CRUD), `backup.ts` (export/import), `auth/`
  (`AuthManager` over Google + Clerk adapters, backend session-token
  exchange), and the `org-*` client modules.
- **`backend/`** — Vercel serverless API over Neon Postgres. `lib/`
  verifies tokens (`resolve-email`, `verify-clerk`, `jwt`) and resolves
  the caller's org/role; `api/` is one file per route (kept under
  Vercel's 12-function Hobby cap by consolidating related routes). See
  `backend/README.md`.

## Testing

`tests/` and `backend/lib/*.test.ts` cover the pure logic — storage,
service, backup, token verification, org-state resolution, tab/reorder
helpers. The sidebar UI and content script are verified manually in a
real browser; that boundary is deliberate.
