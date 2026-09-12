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

- `redirect_uri_mismatch` / the Clerk page 404s → a **one-time developer
  setup** item isn't done. Not something a tester can fix — tell the
  developer. See [For the developer](#for-the-developer--one-time-setup).
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
   it (Neon SQL Editor, or `psql "$DATABASE_URL" -f backend/schema.sql`).
   The whole file is idempotent — **re-run it after pulling** so new
   tables (most recently `rate_limits`) get created. The `DATABASE_URL`
   role must be a plain non-superuser without `BYPASSRLS`, or row-level
   security is silently defeated.
2. Create a **Vercel** project from this repo with **Root Directory =
   `backend`**. It deploys on every push to `main`.
3. Set these environment variables in the Vercel project
   (Settings → Environment Variables):

   | Variable | Required | Value |
   |---|---|---|
   | `DATABASE_URL` | yes | Neon connection string |
   | `SESSION_JWT_SECRET` | yes | `openssl rand -hex 32` — signs 14-day session tokens |
   | `CLERK_ISSUER` | yes | e.g. `https://your-instance.clerk.accounts.dev` (same as `CLERK_DOMAIN` with `https://`) |
   | `CLERK_OAUTH_CLIENT_ID` | yes | from Clerk → OAuth Applications |
   | `CLERK_OAUTH_CLIENT_SECRET` | leave unset | only set this if the Clerk OAuth app is **Confidential**. It should be **Public** (see step 2 below) — leave this var out entirely. |

   > **If sign-in fails with "Client authentication failed... no client
   > authentication included"**: the Clerk OAuth Application is set to
   > Confidential. Either set `CLERK_OAUTH_CLIENT_SECRET` above to its
   > secret, or (recommended) switch the app to **Public** in Clerk and
   > delete this env var if you'd set it. Redeploy after either change —
   > env var edits don't take effect until the next deploy.

4. Put the deployed URL in **`src/shared/api-base.ts`** (`API_BASE_URL`)
   and in `host_permissions` in `manifest.config.ts`. Commit. Testers
   build from this, so their extension points at your backend.

### 2. Clerk sign-in

Sign-in goes entirely through Clerk — one OAuth application that fans out
to Google, GitHub, Microsoft, email, and enterprise SSO, whichever you
enable in the dashboard.

1. Clerk Dashboard → **Configure → OAuth Applications → New application**.
   Scopes `openid email profile`. Redirect URI (exact, trailing slash):
   ```
   https://fhaeedmmhjjkhnopifppigddjbbmdegh.chromiumapp.org/
   ```
   This is the pinned extension ID — it never changes between machines,
   so the URI is added **once, ever**. **Set the application type to
   Public (PKCE), not Confidential** — a browser extension can't keep a
   secret, and a Confidential app fails sign-in with "Client
   authentication failed" unless you also wire up
   `CLERK_OAUTH_CLIENT_SECRET`.
2. Copy the **Client ID** into `src/shared/auth/providers.ts`
   (`CLERK_OAUTH_CLIENT_ID`); set `CLERK_DOMAIN` there to your instance
   host. Commit.
3. Set `CLERK_ISSUER` (and `CLERK_OAUTH_CLIENT_SECRET` if the app is
   confidential) in Vercel. Add your instance host to `host_permissions`
   in `manifest.config.ts` if it differs from the default.
4. In the Clerk Dashboard, turn on the sign-in methods you want under
   **Social Connections** and **SSO Connections** (Google, GitHub, …) —
   no code change. Clerk's dev instance (`*.clerk.accounts.dev`) has no
   allow-list, so any tester can sign in with an enabled method.

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

### Demo data

`examples/showcase.json` — 20 sample buttons across 5 tabs, for a
personal-side demo. Settings → Import tools → pick the file.

`examples/org-seed.sql` — populates Manage Organisation (shared tabs and
prompts, a sample roster, usage snapshots, prompt-run counters) for an
org you've already created. See the comment at the top of that file for
the one value you need to fill in and run in the Neon SQL Editor.

---

## Organisations

Signing in is optional; personal buttons never need it. Signing in adds a
shared prompt list on top:

- **First sign-in at a company domain creates the organisation** and
  makes that person its **admin**. Later sign-ins from the same domain
  land in "waiting for approval" until an admin approves them. (The email
  domain is whatever Clerk reports for the account, whichever method they
  used to sign in.)
- **Public email domains** (`gmail.com`, `outlook.com`, …) never
  auto-join — each such sign-in starts its own separate organisation.
- **Leaving:** a member (or a pending invitee) can leave / cancel from
  Settings at any time. The last admin must promote someone else first.
- **Admins** get **Manage Organisation** in Settings: approve/remove
  members, add anyone by email (they land as **pending** for one-click
  approval), promote/demote admins, create/edit/delete
  shared prompts and tabs, and see per-member usage and prompt-run
  analytics. An organisation can never drop to zero admins.
- **Shared tabs:** members see the org's shared prompts grouped under
  the same clickable tab-chip buttons as their personal tabs (when the
  org has more than one shared tab) — click a tab to see its prompts.
- **Usage reporting:** while signed in, an approved member's
  session/weekly/spend percentages (the same numbers the personal usage
  widget shows) are reported periodically for admins to see. Stops on
  sign-out.

Every admin-only action is enforced **server-side**: the backend
re-derives the caller's email from their verified identity token and
re-checks their own membership row on every request. The client cannot
assert its own email, org, role, or admin status. Cross-organisation
isolation is enforced by Postgres row-level security
(`FORCE ROW LEVEL SECURITY`), not just by `WHERE` clauses. **Every API
route is rate-limited** (fixed window, in the `rate_limits` table — no
extra service). Sign-in is limited per-IP before it does any token
verification at all (a flood of invalid tokens can't run up Vercel
invocations); onboarding, prompt-run and usage-report are limited
per-authenticated-caller with a tighter, abuse-shape-specific window;
every other route (org session, roster, shared tabs/prompts, analytics,
usage) gets a generic per-IP ceiling via a shared `withRateLimit`
wrapper (`backend/lib/with-rate-limit.ts`), also checked before the
route's own logic runs.

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
  (`ClerkAuthAdapter` — OAuth code + PKCE, backend session-token
  exchange), and the `org-*` client modules.
- **`backend/`** — Vercel serverless API over Neon Postgres. `lib/`
  verifies tokens (`resolve-email`, `verify-clerk`, `jwt`) and resolves
  the caller's org/role; `api/` is one file per route (kept under
  Vercel's 12-function Hobby cap by consolidating related routes). See
  `backend/README.md`.

## Testing

`tests/` and `backend/lib/*.test.ts` cover the pure logic — storage,
service, backup, token verification, org-state resolution, tab/reorder
helpers.

`e2e/` drives the **real unpacked extension in a real Chromium** with
Playwright (not a mocked DOM) — the pinned extension ID, button CRUD,
skill badges, keyboard reorder, tab creation and the tab-picker dropdown,
export/import (including a corrupt-file case), storage surviving a
reload; via `e2e/mock-backend.ts` stubbing
`chrome.identity.launchWebAuthFlow` and the backend's `fetch` responses,
never a real Clerk account or the live Vercel backend, the director/
member/pending organisation views (shared prompts, roster, analytics);
and, via `e2e/claude-insertion.spec.ts` loading the exact compiled
`content-script.ts` bundle that ships in the extension onto a local
fixture page (never claude.ai itself — see that file's comment for why),
real `execCommand`-based prompt insertion, the missing-chat-input error
path, and send-detection (the input holding text then clearing) all
running for real, not simulated. Run it:

```bash
pnpm run build        # e2e loads dist/, not source
pnpm run e2e:install   # one-time: downloads the Chromium build Playwright drives
pnpm run e2e
```

It opens real (visible) Chromium windows while it runs — Chrome extensions
don't support a headless mode, so this can't run invisibly the way
`vitest` does.

**Not covered by `e2e/`**, still manual, via
[`docs/qa-checklist.md`](docs/qa-checklist.md): whether Clerk, the real
backend, and claude.ai's *actual* page structure still match what the
mocks and the local fixture assume — none of that can be proven without
running against the live deployment and the live site. The fixture in
`claude-insertion.spec.ts` is our own approximation of claude.ai's chat
input; if Anthropic changes that DOM, the fixture test keeps passing
while the real extension breaks. What automated e2e now catches instead
is regressions in our own insertion/send-detection code — historically
the more common failure — not drift in a page we don't control.

**CI** (`.github/workflows/ci.yml`) runs on every push and PR to `main`:
typecheck + the full test suite + `vite build` for the extension,
typecheck + tests for `backend/`, and the `e2e/` suite in a headed
Chromium under Xvfb. It catches a broken commit before it reaches
`main` — it does not replace the manual checklist for the parts above
that no automated test touches.

## Known limitations

- **Depends on one claude.ai selector** (`[data-testid="chat-input"]`).
  If Anthropic renames it, insertion and the usage widget break at the
  same time; you'd see a clean "couldn't find Claude's chat box" error,
  not a crash, but it needs a code fix regardless.
- **Demo Alfabet font.** The bundled woff2 files are from a Fontspring
  DEMO license with most punctuation and a few digits stripped from
  their character map (see the comment in `style.css`) so the browser
  falls back to a system font for those glyphs instead of drawing a
  broken placeholder shape. Swap in AIRE's licensed webfont files before
  any public/commercial release.
- **Automated coverage stops at the boundary of third-party services**
  (claude.ai, Clerk, the live backend), by design. `e2e/` (see Testing)
  runs the real extension code — including the exact compiled
  content-script bundle for insertion and send-detection — against local
  mocks and fixtures, so everything this codebase controls is covered by
  a real test, in a real browser. Running live tests with real
  credentials against Anthropic's and Clerk's production services on
  every commit isn't something any CI setup does safely: it means
  storing live credentials in CI, scripting a third party's site on
  every push, and mutating real backend data each run. The standard
  practice for that boundary — used here too, via
  [`docs/qa-checklist.md`](docs/qa-checklist.md) — is a manual pass
  against the live deployment, the same way any team verifies the parts
  that live outside their own infrastructure.
