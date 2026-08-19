# Phase 2C: Extension Auth Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user sign in with Google from the sidebar's Settings panel and see their company's shared prompts in a read-only "Team" section, backed by the live Phase 2B API.

**Architecture:** A new `AuthAdapter`/`GoogleAuthAdapter` pair (mirroring the existing `StorageAdapter` pattern) obtains a Google ID token via `chrome.identity.launchWebAuthFlow()`. A new `org-prompts.ts` module fetches and caches the signed-in user's org prompts from the Phase 2B API. Settings gains a sign-in/out control; the sidebar gains a read-only Team section below the personal button list.

**Tech Stack:** TypeScript + Vite (CRXJS), pnpm, vanilla TS + DOM, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-phase2-login-team-storage-design.md` (see the 2026-08-19 correction near the top of "Extension changes" — this plan implements the corrected mechanism, not the spec's original wording).

## Global Constraints

- Package manager is pnpm, never npm.
- No new npm dependencies.
- Auth mechanism is `chrome.identity.launchWebAuthFlow()` requesting `response_type=id_token` in a manually-built Google authorization URL — **not** `chrome.identity.getAuthToken()`, which only returns an OAuth access token, not the ID token (JWT) the already-live backend verifies.
- Google OAuth Client ID: `14020508582-hat1hneq6stdouu0kc30p9vlfpfi69t7.apps.googleusercontent.com`.
- Backend API base URL: `https://claude-extension-git-main-luxqees-projects.vercel.app` (confirmed live).
- **Flagged, real uncertainty carried into Task 3's manual verification:** the Client ID above was created as Google Cloud OAuth type "Chrome Extension." It's unconfirmed whether Google accepts this client type's configuration for `launchWebAuthFlow`'s `https://<extension-id>.chromiumapp.org/` redirect URI, or whether a second Client ID of type "Web application" (with that exact redirect URI registered) will be needed. This cannot be resolved by code alone — only by testing sign-in in a loaded browser.
- ID tokens are short-lived and there is no automatic silent-refresh cache the way `getAuthToken()` has one built in — token freshness is checked locally (via the JWT's `exp` claim) before each use, with a non-interactive `launchWebAuthFlow` retry as the refresh path.
- No new `StorageAdapter`/`ToolService` involvement — the auth session and cached org prompts are separate `chrome.storage.local` keys, read and written directly by the new auth and org-prompts modules.
- Testing convention: pure logic (URL building, JWT decoding, response parsing) gets full TDD coverage in `tests/shared/`. Everything touching `chrome.identity`, `chrome.storage`, or the DOM is manual-verification-only, matching this project's established boundary for every prior content-script/UI task.
- Run `pnpm test` and `pnpm run build` (`tsc --noEmit && vite build`) at the end of every task; both must be clean before committing.

---

### Task 1: AuthAdapter + GoogleAuthAdapter (TDD on the pure pieces)

**Files:**
- Create: `src/shared/auth/auth-adapter.ts`
- Create: `src/shared/auth/google-auth-adapter.ts`
- Test: `tests/shared/auth/google-auth-adapter.test.ts`

**Interfaces:**
- Produces: `AuthAdapter` interface, `GoogleAuthAdapter` class implementing it, and the pure exported helpers `buildGoogleAuthUrl`, `extractIdTokenFromRedirect`, `decodeIdToken`, `isTokenExpired` — all consumed by Task 4 (`main.ts`) and, indirectly, by `GoogleAuthAdapter` itself.

- [ ] **Step 1: Write the interface file**

Create `src/shared/auth/auth-adapter.ts`:

```ts
export interface AuthAdapter {
  signIn(): Promise<{ email: string; idToken: string } | null>
  signOut(): Promise<void>
  getCurrentSession(): Promise<{ email: string } | null>
  getValidIdToken(): Promise<string | null>
}
```

Note: this has one more method than the spec's original 3-method sketch (`signIn`/`signOut`/`getCurrentSession`). `getValidIdToken()` is a deliberate, small addition — it's what `org-prompts.ts` (Task 2) calls to get a token ready to use for an API request, silently refreshing an expired one first. Without it, that refresh logic would have to live outside the adapter, breaking the "swap the adapter, nothing else changes" design the spec asks for.

- [ ] **Step 2: Write the failing tests for the pure helpers**

Create `tests/shared/auth/google-auth-adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildGoogleAuthUrl,
  extractIdTokenFromRedirect,
  decodeIdToken,
  isTokenExpired,
} from '../../../src/shared/auth/google-auth-adapter'

function makeFakeIdToken(payload: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${encode(header)}.${encode(payload)}.fake-signature`
}

describe('buildGoogleAuthUrl', () => {
  it('includes the client id, id_token response type, redirect uri, scope, and nonce', () => {
    const url = buildGoogleAuthUrl('https://abc123.chromiumapp.org/', 'test-nonce')
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(parsed.searchParams.get('client_id')).toBe(
      '14020508582-hat1hneq6stdouu0kc30p9vlfpfi69t7.apps.googleusercontent.com',
    )
    expect(parsed.searchParams.get('response_type')).toBe('id_token')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://abc123.chromiumapp.org/')
    expect(parsed.searchParams.get('scope')).toBe('openid email')
    expect(parsed.searchParams.get('nonce')).toBe('test-nonce')
  })
})

describe('extractIdTokenFromRedirect', () => {
  it('extracts the id_token from a redirect URL fragment', () => {
    const url = 'https://abc123.chromiumapp.org/#id_token=abc.def.ghi&state=xyz'
    expect(extractIdTokenFromRedirect(url)).toBe('abc.def.ghi')
  })

  it('returns null when the URL has no fragment', () => {
    expect(extractIdTokenFromRedirect('https://abc123.chromiumapp.org/')).toBeNull()
  })

  it('returns null when the fragment has no id_token param', () => {
    expect(extractIdTokenFromRedirect('https://abc123.chromiumapp.org/#state=xyz')).toBeNull()
  })
})

describe('decodeIdToken', () => {
  it('decodes email and exp from a well-formed token', () => {
    const token = makeFakeIdToken({ email: 'alice@acme.com', exp: 1999999999 })
    expect(decodeIdToken(token)).toEqual({ email: 'alice@acme.com', exp: 1999999999 })
  })

  it('returns null email and exp for a token with fewer than 3 parts', () => {
    expect(decodeIdToken('not-a-jwt')).toEqual({ email: null, exp: null })
  })

  it('returns null email and exp when the payload is not valid JSON', () => {
    const badPayload = Buffer.from('not json').toString('base64url')
    expect(decodeIdToken(`header.${badPayload}.sig`)).toEqual({ email: null, exp: null })
  })

  it('returns null email when the payload has no email claim', () => {
    const token = makeFakeIdToken({ exp: 1999999999 })
    expect(decodeIdToken(token)).toEqual({ email: null, exp: 1999999999 })
  })
})

describe('isTokenExpired', () => {
  const now = 1700000000

  it('returns false for an exp comfortably in the future', () => {
    expect(isTokenExpired(now + 3600, now)).toBe(false)
  })

  it('returns true for an exp in the past', () => {
    expect(isTokenExpired(now - 10, now)).toBe(true)
  })

  it('returns true for an exp within the 60-second skew window', () => {
    expect(isTokenExpired(now + 30, now)).toBe(true)
  })

  it('returns true when exp is null', () => {
    expect(isTokenExpired(null, now)).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- google-auth-adapter.test.ts`
Expected: FAIL — `Cannot find module '../../../src/shared/auth/google-auth-adapter'`

- [ ] **Step 4: Implement the pure helpers and the adapter class**

Create `src/shared/auth/google-auth-adapter.ts`:

```ts
import type { AuthAdapter } from './auth-adapter'

const GOOGLE_CLIENT_ID = '14020508582-hat1hneq6stdouu0kc30p9vlfpfi69t7.apps.googleusercontent.com'
const SESSION_STORAGE_KEY = 'authSession'
const EXPIRY_SKEW_SECONDS = 60

interface StoredSession {
  email: string
  idToken: string
}

export function buildGoogleAuthUrl(redirectUri: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'id_token',
    redirect_uri: redirectUri,
    scope: 'openid email',
    nonce,
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function extractIdTokenFromRedirect(redirectUrl: string): string | null {
  const hashIndex = redirectUrl.indexOf('#')
  if (hashIndex === -1) return null
  const params = new URLSearchParams(redirectUrl.slice(hashIndex + 1))
  return params.get('id_token')
}

export interface DecodedIdToken {
  email: string | null
  exp: number | null
}

export function decodeIdToken(idToken: string): DecodedIdToken {
  const parts = idToken.split('.')
  if (parts.length !== 3) return { email: null, exp: null }
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized)) as Record<string, unknown>
    const email = typeof payload.email === 'string' ? payload.email : null
    const exp = typeof payload.exp === 'number' ? payload.exp : null
    return { email, exp }
  } catch {
    return { email: null, exp: null }
  }
}

export function isTokenExpired(exp: number | null, nowSeconds: number): boolean {
  if (exp === null) return true
  return nowSeconds >= exp - EXPIRY_SKEW_SECONDS
}

export class GoogleAuthAdapter implements AuthAdapter {
  private async runAuthFlow(interactive: boolean): Promise<{ email: string; idToken: string } | null> {
    const redirectUri = chrome.identity.getRedirectURL()
    const nonce = crypto.randomUUID()
    const authUrl = buildGoogleAuthUrl(redirectUri, nonce)

    let redirectUrl: string | undefined
    try {
      redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive })
    } catch (error) {
      console.error('[Claude Tools] Google sign-in flow failed', error)
      return null
    }
    if (!redirectUrl) return null

    const idToken = extractIdTokenFromRedirect(redirectUrl)
    if (!idToken) return null

    const { email } = decodeIdToken(idToken)
    if (!email) return null

    const session: StoredSession = { email, idToken }
    await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session })
    return session
  }

  async signIn(): Promise<{ email: string; idToken: string } | null> {
    return this.runAuthFlow(true)
  }

  async signOut(): Promise<void> {
    await chrome.storage.local.remove(SESSION_STORAGE_KEY)
  }

  async getCurrentSession(): Promise<{ email: string } | null> {
    const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY)
    const session = stored[SESSION_STORAGE_KEY] as StoredSession | undefined
    return session ? { email: session.email } : null
  }

  async getValidIdToken(): Promise<string | null> {
    const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY)
    const session = stored[SESSION_STORAGE_KEY] as StoredSession | undefined
    if (session) {
      const { exp } = decodeIdToken(session.idToken)
      if (!isTokenExpired(exp, Math.floor(Date.now() / 1000))) {
        return session.idToken
      }
    }
    const refreshed = await this.runAuthFlow(false)
    if (!refreshed) {
      // Silent refresh failed outright -- the stored session is stale and
      // unusable. Clear it so getCurrentSession() correctly reflects that
      // sign-in is needed again, rather than continuing to report an email
      // that no longer has a working token behind it.
      await chrome.storage.local.remove(SESSION_STORAGE_KEY)
    }
    return refreshed?.idToken ?? null
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- google-auth-adapter.test.ts`
Expected: PASS, all 12 tests green.

- [ ] **Step 6: Run the full suite and build, then commit**

Run: `pnpm test && pnpm run build`
Expected: all existing tests still pass, build succeeds.

```bash
git add src/shared/auth/auth-adapter.ts src/shared/auth/google-auth-adapter.ts tests/shared/auth/google-auth-adapter.test.ts
git commit -m "feat: add AuthAdapter and GoogleAuthAdapter using launchWebAuthFlow"
```

---

### Task 2: org-prompts.ts (TDD on response parsing)

**Files:**
- Create: `src/shared/org-prompts.ts`
- Test: `tests/shared/org-prompts.test.ts`

**Interfaces:**
- Produces: `OrgPrompt` (`{ name: string; promptText: string; type: 'prompt' | 'skill' }`), `OrgPromptsResult` (`{ orgName: string | null; prompts: OrgPrompt[] }`), `parseOrgPromptsResponse(raw: unknown): OrgPromptsResult`, `fetchOrgPrompts(idToken: string): Promise<OrgPromptsResult | null>`, `loadOrgPrompts(idToken: string): Promise<OrgPromptsResult>`, `getCachedOrgPrompts(): Promise<OrgPromptsResult | null>` — all consumed by Task 4 (`main.ts`).

This mirrors the existing `src/shared/usage.ts` module's defensive-parsing style exactly: `parseOrgPromptsResponse` never throws, ignores anything it doesn't recognize, and degrades to an empty/null result rather than erroring.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/org-prompts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrgPromptsResponse } from '../../src/shared/org-prompts'

describe('parseOrgPromptsResponse', () => {
  it('parses a matched org with prompts', () => {
    const raw = {
      org: { name: 'Acme' },
      prompts: [
        { name: 'Summarize', prompt_text: 'Summarize this.', type: 'prompt' },
        { name: 'Doc Summary', prompt_text: '/doc-summary', type: 'skill' },
      ],
    }
    expect(parseOrgPromptsResponse(raw)).toEqual({
      orgName: 'Acme',
      prompts: [
        { name: 'Summarize', promptText: 'Summarize this.', type: 'prompt' },
        { name: 'Doc Summary', promptText: '/doc-summary', type: 'skill' },
      ],
    })
  })

  it('returns a null org name and empty prompts when org is null', () => {
    expect(parseOrgPromptsResponse({ org: null, prompts: [] })).toEqual({ orgName: null, prompts: [] })
  })

  it('skips a prompt entry missing required fields instead of throwing', () => {
    const raw = { org: { name: 'Acme' }, prompts: [{ name: 'Bad' }] }
    expect(() => parseOrgPromptsResponse(raw)).not.toThrow()
    expect(parseOrgPromptsResponse(raw).prompts).toEqual([])
  })

  it('skips a prompt entry with an unrecognized type', () => {
    const raw = { org: { name: 'Acme' }, prompts: [{ name: 'X', prompt_text: 'y', type: 'bogus' }] }
    expect(parseOrgPromptsResponse(raw).prompts).toEqual([])
  })

  it('returns null org name and empty prompts for non-object input, without throwing', () => {
    expect(parseOrgPromptsResponse(null)).toEqual({ orgName: null, prompts: [] })
    expect(parseOrgPromptsResponse(undefined)).toEqual({ orgName: null, prompts: [] })
    expect(parseOrgPromptsResponse('nope')).toEqual({ orgName: null, prompts: [] })
  })

  it('returns empty prompts when the prompts field is missing entirely', () => {
    expect(parseOrgPromptsResponse({ org: { name: 'Acme' } })).toEqual({ orgName: 'Acme', prompts: [] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- org-prompts.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/org-prompts'`

- [ ] **Step 3: Implement the module**

Create `src/shared/org-prompts.ts`:

```ts
export interface OrgPrompt {
  name: string
  promptText: string
  type: 'prompt' | 'skill'
}

export interface OrgPromptsResult {
  orgName: string | null
  prompts: OrgPrompt[]
}

const API_BASE_URL = 'https://claude-extension-git-main-luxqees-projects.vercel.app'
const CACHE_STORAGE_KEY = 'orgPromptsCache'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePrompt(entry: unknown): OrgPrompt | null {
  if (!isRecord(entry)) return null
  const name = entry.name
  const promptText = entry.prompt_text
  const type = entry.type
  if (typeof name !== 'string' || typeof promptText !== 'string') return null
  if (type !== 'prompt' && type !== 'skill') return null
  return { name, promptText, type }
}

export function parseOrgPromptsResponse(raw: unknown): OrgPromptsResult {
  if (!isRecord(raw)) return { orgName: null, prompts: [] }

  const org = raw.org
  const orgName = isRecord(org) && typeof org.name === 'string' ? org.name : null

  const prompts: OrgPrompt[] = []
  if (Array.isArray(raw.prompts)) {
    for (const entry of raw.prompts) {
      const prompt = parsePrompt(entry)
      if (prompt) prompts.push(prompt)
    }
  }

  return { orgName, prompts }
}

export async function fetchOrgPrompts(idToken: string): Promise<OrgPromptsResult | null> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/org-prompts`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to fetch org prompts', error)
    return null
  }

  if (!response.ok) {
    console.error('[Claude Tools] org-prompts endpoint returned status', response.status)
    return null
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] org-prompts response was not valid JSON', error)
    return null
  }

  return parseOrgPromptsResponse(body)
}

export async function getCachedOrgPrompts(): Promise<OrgPromptsResult | null> {
  const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY)
  const cached = stored[CACHE_STORAGE_KEY]
  return cached ? (cached as OrgPromptsResult) : null
}

async function setCachedOrgPrompts(result: OrgPromptsResult): Promise<void> {
  await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: result })
}

export async function loadOrgPrompts(idToken: string): Promise<OrgPromptsResult> {
  const fresh = await fetchOrgPrompts(idToken)
  if (fresh) {
    await setCachedOrgPrompts(fresh)
    return fresh
  }
  const cached = await getCachedOrgPrompts()
  return cached ?? { orgName: null, prompts: [] }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- org-prompts.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Run the full suite and build, then commit**

Run: `pnpm test && pnpm run build`
Expected: all tests pass, build succeeds.

```bash
git add src/shared/org-prompts.ts tests/shared/org-prompts.test.ts
git commit -m "feat: add org-prompts fetch, parse, and cache logic"
```

---

### Task 3: Sign in / Sign out in Settings

**Files:**
- Modify: `src/sidepanel/SettingsPanel.ts`
- Modify: `src/sidepanel/render.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/style.css`

**Interfaces:**
- Consumes: `AuthAdapter`, `GoogleAuthAdapter` (Task 1).
- Produces: `renderApp`'s signature gains a `session: { email: string } | null` parameter — Task 4 depends on this exact position (inserted after `settingsState`, before `context`).

This task is manual-verification-only (real `chrome.identity`/DOM interaction — no test infrastructure for this exists or should be added), **and its manual verification must explicitly cover the flagged OAuth-client-type uncertainty from Global Constraints** — see the checklist at the end of this task.

- [ ] **Step 1: Add the sign-in/out section to the Settings panel**

In `src/sidepanel/SettingsPanel.ts`, change the `SettingsPanelContext` interface (currently `{ onExport, onImport, onBack, importError, importSuccessCount }`) to:

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
}
```

Immediately after the existing `container.appendChild(heading)` line, and before the existing `const exportSection = document.createElement('div')` line, insert:

```ts
  const authSection = document.createElement('div')
  authSection.className = 'settings-section'
  if (context.session) {
    const signedInAs = document.createElement('p')
    signedInAs.className = 'settings-hint'
    signedInAs.textContent = `Signed in as ${context.session.email}`
    authSection.appendChild(signedInAs)

    const signOutButton = document.createElement('button')
    signOutButton.type = 'button'
    signOutButton.className = 'settings-action-button'
    signOutButton.textContent = 'Sign out'
    signOutButton.addEventListener('click', context.onSignOut)
    authSection.appendChild(signOutButton)
  } else {
    const signInButton = document.createElement('button')
    signInButton.type = 'button'
    signInButton.className = 'settings-action-button'
    signInButton.textContent = 'Sign in with Google'
    signInButton.addEventListener('click', context.onSignIn)
    authSection.appendChild(signInButton)

    const signInHint = document.createElement('p')
    signInHint.className = 'settings-hint'
    signInHint.textContent = "See your company's shared prompts, if your organization has set them up."
    authSection.appendChild(signInHint)
  }
  container.appendChild(authSection)

```

- [ ] **Step 2: Thread `session` through `render.ts`**

In `src/sidepanel/render.ts`, add two new callbacks to the `RenderContext` interface, alongside the existing `onSettingsBack`:

```ts
  onSignIn: () => void
  onSignOut: () => void
```

Change the `renderApp` function signature (currently `root, buttons, view, runState, settingsState, context`) to insert `session` before `context`:

```ts
export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  session: { email: string } | null,
  context: RenderContext,
): void {
```

In the existing `if (view.mode === 'settings')` block, add `session`, `onSignIn`, and `onSignOut` to the object passed to `renderSettingsPanel`:

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
      }),
    )
    return
  }
```

- [ ] **Step 3: Wire it up in `main.ts`**

In `src/sidepanel/main.ts`, add the import at the top, alongside the existing imports:

```ts
import { GoogleAuthAdapter } from '../shared/auth/google-auth-adapter'
```

Add near the existing `const toolService = new ToolService(new ChromeLocalStorageAdapter())` line:

```ts
const authAdapter = new GoogleAuthAdapter()
```

Add a module-level variable near the existing `let view: View = { mode: 'list' }` line:

```ts
let session: { email: string } | null = null
```

Update the call to `renderApp` inside `refresh` to pass `session` before the context object:

```ts
    renderApp(root, buttons, view, runState, settingsState, session, {
```

(This is the same call already at the top of `refresh` — only the argument list changes, the object literal that follows is unchanged.)

Add two new handlers to the object passed to `renderApp`, alongside the existing `onSettingsBack`:

```ts
      onSignIn: async () => {
        const result = await authAdapter.signIn()
        if (result) {
          session = { email: result.email }
          announce(`Signed in as ${result.email}`)
        } else {
          announce('Sign in was not completed.')
        }
        await refresh(root)
      },
      onSignOut: async () => {
        await authAdapter.signOut()
        session = null
        await refresh(root)
      },
```

At the very bottom of the file, change:

```ts
void refresh(root)
```

to:

```ts
async function start(): Promise<void> {
  session = await authAdapter.getCurrentSession()
  await refresh(root)
}

void start()
```

- [ ] **Step 4: Add CSS for the sign-in state (reuses existing classes, only new content needed)**

No new CSS classes are needed for this task — `authSection` reuses `.settings-section`, `.settings-action-button`, and `.settings-hint`, all of which already exist in `src/sidepanel/style.css`. Skip this step; it's listed only so a reader doesn't wonder why `style.css` isn't touched despite being listed under Files (it's listed because Task 4 modifies it — this task doesn't need to).

- [ ] **Step 5: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: existing tests pass; build succeeds. (`renderApp`'s new parameter will cause a type error if any call site wasn't updated — there is exactly one call site, in `main.ts`, updated in Step 3.)

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/SettingsPanel.ts src/sidepanel/render.ts src/sidepanel/main.ts
git commit -m "feat: add Google sign-in/out to the Settings panel"
```

- [ ] **Step 7: Manual verification checklist (required — this is the first real test of the flagged OAuth risk)**

Build (`pnpm run build`), reload the unpacked extension in `chrome://extensions`, open the sidebar on a claude.ai tab, go to Settings, and click "Sign in with Google."

**If a Google account picker/consent screen opens and completing it returns you to the extension showing "Signed in as your@email.com":** the existing Client ID works with `launchWebAuthFlow` as-is. Nothing further needed — proceed to Task 4.

**If instead you see an error page from Google mentioning something like `redirect_uri_mismatch`, `invalid_request`, or the client ID/redirect URI not being recognized:** this is the flagged risk materializing. To fix:
1. In Google Cloud Console, note the exact redirect URI Chrome is using — either read it from the error page itself, or find it by temporarily adding `console.log(chrome.identity.getRedirectURL())` to `signIn()` and checking the sidepanel's DevTools console (right-click the sidebar → Inspect). It will look like `https://<32-character-extension-id>.chromiumapp.org/`.
2. Create a **second** OAuth Client ID in the same Google Cloud project, this time of type **"Web application"** (not "Chrome Extension").
3. Under that new client's "Authorized redirect URIs," add the exact URI from step 1.
4. Copy the new Client ID and replace the `GOOGLE_CLIENT_ID` constant in `src/shared/auth/google-auth-adapter.ts` with it.
5. **Also update the backend's `GOOGLE_OAUTH_CLIENT_ID` environment variable in the Vercel project to this same new Client ID, and redeploy.** `backend/api/org-prompts.ts` verifies the ID token's `aud` claim against this env var — if it still points at the old "Chrome Extension" client ID after switching the extension to the new "Web application" client ID, every `/api/org-prompts` request will 401. That failure is silent in the UI (it degrades to the same empty state as "no org matches your domain" — see the note below), so this step is easy to miss and hard to notice went wrong.
6. Rebuild, reload the extension, and try signing in again.

**Note on a silent-failure gap this creates:** a 401 from `/api/org-prompts` (e.g. from the audience mismatch in step 5, or any other auth failure) and a legitimate "no organization matches your email's domain" both currently render as the same thing — no Team section, no error. When running this checklist, open the sidepanel's DevTools console (right-click the sidebar → Inspect) and check for `[Claude Tools] org-prompts endpoint returned status 401` (or similar) before concluding "no org set up yet" is the correct explanation for a missing Team section.

Either way, once sign-in succeeds, also verify: clicking "Sign out" returns to the "Sign in with Google" state, and reopening the sidebar after a successful sign-in (without signing out) still shows "Signed in as ..." — confirming the session persisted across a reload via `getCurrentSession()`.

---

### Task 4: Team section in the sidebar

**Files:**
- Create: `src/sidepanel/TeamSection.ts`
- Modify: `src/sidepanel/render.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/style.css`

**Interfaces:**
- Consumes: `OrgPrompt`, `OrgPromptsResult`, `loadOrgPrompts` (Task 2); `session`, the Task 3 end-state of `render.ts`/`main.ts` this task modifies further.
- Produces: `renderTeamSection(orgName, prompts, onRun): HTMLElement`. `renderApp`'s signature gains a further `teamPrompts: OrgPromptsResult` parameter, inserted after `session`, before `context`.

This task is manual-verification-only (DOM rendering, `chrome.storage`, `chrome.tabs.sendMessage` — same boundary as every other sidepanel UI task).

Team prompts are deliberately simpler than personal buttons: clicking a row runs it (inserts the prompt into claude.ai, exactly like a personal button), but there is no per-row "Running…"/error status text and no edit/delete/drag controls, matching the spec's "read-only" description. A shared "don't start a second run while one is in flight" guard is reused from the personal-button run state; team rows don't get their own parallel state-tracking structure, which would be more machinery than this minimal slice needs.

- [ ] **Step 1: Write the Team section renderer**

Create `src/sidepanel/TeamSection.ts`:

```ts
import type { OrgPrompt } from '../shared/org-prompts'

export function renderTeamSection(
  orgName: string,
  prompts: OrgPrompt[],
  onRun: (prompt: OrgPrompt) => void,
): HTMLElement {
  const section = document.createElement('div')
  section.className = 'team-section'

  const heading = document.createElement('h3')
  heading.className = 'team-section-heading'
  heading.textContent = `Team — ${orgName}`
  section.appendChild(heading)

  const list = document.createElement('ul')
  list.className = 'team-list'
  prompts.forEach((prompt) => {
    const item = document.createElement('li')
    item.className = 'team-row'

    if (prompt.type === 'skill') {
      const badge = document.createElement('span')
      badge.className = 'skill-badge'
      badge.textContent = '/'
      badge.setAttribute('aria-hidden', 'true')
      item.appendChild(badge)
    }

    const name = document.createElement('button')
    name.type = 'button'
    name.className = 'team-row-name'
    name.textContent = prompt.name
    name.setAttribute('aria-label', `Run ${prompt.name}`)
    name.addEventListener('click', () => onRun(prompt))
    item.appendChild(name)

    list.appendChild(item)
  })
  section.appendChild(list)

  return section
}
```

- [ ] **Step 2: Add CSS for the Team section**

In `src/sidepanel/style.css`, add after the existing `.skill-badge { ... }` rule:

```css
.team-section {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.team-section-heading {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.team-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.team-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.team-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font: inherit;
  font-weight: 500;
  color: inherit;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.team-row-name:hover {
  background: var(--surface-hover);
  border-radius: 4px;
}
```

- [ ] **Step 3: Wire the Team section into `render.ts`**

In `src/sidepanel/render.ts`, add to the imports:

```ts
import { renderTeamSection } from './TeamSection'
import type { OrgPrompt, OrgPromptsResult } from '../shared/org-prompts'
```

Add one new callback to the `RenderContext` interface, alongside `onSignIn`/`onSignOut`:

```ts
  onRunTeamPrompt: (prompt: OrgPrompt) => void
```

Change the `renderApp` signature again, adding `teamPrompts` after `session`:

```ts
export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  session: { email: string } | null,
  teamPrompts: OrgPromptsResult,
  context: RenderContext,
): void {
```

At the very end of the function, right after the existing `root.appendChild(list)` line that closes out the personal button list (and after that whole `buttons.forEach(...)` block), add:

```ts
  if (teamPrompts.prompts.length > 0) {
    root.appendChild(
      renderTeamSection(teamPrompts.orgName ?? 'Team', teamPrompts.prompts, context.onRunTeamPrompt),
    )
  }
```

Note this sits after the early `return` inside the `if (buttons.length === 0)` block — so if there are no personal buttons, execution never reaches this new code and the Team section wouldn't show. That's an existing structural quirk of this function, not something this task should fix (fixing it is out of scope — flag it in your task report as a minor observation, don't change it): the empty-state early return was written before Team sections existed. Team users with zero personal buttons are an edge case; leaving it as a known, reported minor gap is fine for this slice.

- [ ] **Step 4: Wire fetching into `main.ts`**

In `src/sidepanel/main.ts`, add to the imports:

```ts
import { loadOrgPrompts, type OrgPrompt, type OrgPromptsResult } from '../shared/org-prompts'
```

Add a module-level variable near `let session: { email: string } | null = null`:

```ts
let teamPrompts: OrgPromptsResult = { orgName: null, prompts: [] }
```

Add a new function near `refresh`:

```ts
async function refreshTeamPrompts(root: HTMLElement): Promise<void> {
  const idToken = await authAdapter.getValidIdToken()
  if (!idToken) {
    // getValidIdToken() already cleared the stored session if the silent
    // refresh failed outright -- check whether that happened so we only
    // prompt the user to sign in again when it's actually needed, not on
    // every call (e.g. a call made while genuinely signed out already).
    const stillSignedIn = await authAdapter.getCurrentSession()
    if (session && !stillSignedIn) {
      session = null
      announce('Please sign in again to see your team prompts.')
    }
    teamPrompts = { orgName: null, prompts: [] }
    if (view.mode === 'list') await refresh(root)
    return
  }
  teamPrompts = await loadOrgPrompts(idToken)
  if (view.mode === 'list') await refresh(root)
}
```

Update the call to `renderApp` inside `refresh` to pass `teamPrompts` after `session`:

```ts
    renderApp(root, buttons, view, runState, settingsState, session, teamPrompts, {
```

Update the existing `onSignIn` handler (added in Task 3) to also refresh team prompts after a successful sign-in — replace:

```ts
      onSignIn: async () => {
        const result = await authAdapter.signIn()
        if (result) {
          session = { email: result.email }
          announce(`Signed in as ${result.email}`)
        } else {
          announce('Sign in was not completed.')
        }
        await refresh(root)
      },
```

with:

```ts
      onSignIn: async () => {
        const result = await authAdapter.signIn()
        if (result) {
          session = { email: result.email }
          announce(`Signed in as ${result.email}`)
          await refresh(root)
          void refreshTeamPrompts(root)
        } else {
          announce('Sign in was not completed.')
          await refresh(root)
        }
      },
```

Update the existing `onSignOut` handler to also clear team prompts — replace:

```ts
      onSignOut: async () => {
        await authAdapter.signOut()
        session = null
        await refresh(root)
      },
```

with:

```ts
      onSignOut: async () => {
        await authAdapter.signOut()
        session = null
        teamPrompts = { orgName: null, prompts: [] }
        await refresh(root)
      },
```

Add a new `onRunTeamPrompt` handler, alongside the existing `onSignIn`/`onSignOut`:

```ts
      onRunTeamPrompt: async (prompt: OrgPrompt) => {
        const alreadyRunning = [...runState.values()].some((state) => state.isRunning)
        if (alreadyRunning) return
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab?.id || !tab.url) {
            announce('Open claude.ai to use this tool.')
            return
          }
          const request: InsertPromptRequest = { type: 'INSERT_PROMPT', prompt: prompt.promptText }
          let response: InsertPromptResponse
          try {
            response = await chrome.tabs.sendMessage<InsertPromptRequest, InsertPromptResponse>(
              tab.id,
              request,
            )
          } catch (error) {
            console.error('[Claude Tools] failed to reach content script', error)
            announce('Reload the Claude tab and try again.')
            return
          }
          if (response.ok) {
            announce(`Inserted ${prompt.name}.`)
          } else {
            console.error('[Claude Tools] team prompt run failed', response.error, response.message)
            announce(response.message)
          }
        } catch (error) {
          console.error('[Claude Tools] unexpected error running team prompt', error)
          announce('Something went wrong running that tool. Check the console for details.')
        }
      },
```

Update the `start()` function (added in Task 3) to also fetch team prompts if a session already exists — replace:

```ts
async function start(): Promise<void> {
  session = await authAdapter.getCurrentSession()
  await refresh(root)
}

void start()
```

with:

```ts
async function start(): Promise<void> {
  session = await authAdapter.getCurrentSession()
  await refresh(root)
  if (session) void refreshTeamPrompts(root)
}

void start()
```

- [ ] **Step 5: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: existing tests pass; build succeeds with no type errors (the `renderApp` signature change must match its one call site, updated in Step 4).

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/TeamSection.ts src/sidepanel/render.ts src/sidepanel/main.ts src/sidepanel/style.css
git commit -m "feat: add read-only Team section fetching org prompts after sign-in"
```

- [ ] **Step 7: Manual verification**

With Task 3's sign-in already working (per its checklist), and at least one organization + prompt seeded in the live database matching your Google account's email domain (see Phase 2B's README for the seeding SQL): sign in, and confirm the Team section appears below your personal buttons showing the seeded prompt(s), with skill-type prompts showing the `/` badge. Click a team prompt while on a claude.ai tab and confirm it inserts into the chat box exactly like a personal button. Sign out and confirm the Team section disappears. Reopen the sidebar while still signed in (without running anything) and confirm the Team section still appears without needing to click anything — proving the on-load fetch in `start()` works.

If no organization matches your email's domain yet, you should instead see: no Team section, no error, nothing broken — confirming the spec's "not an error, a neutral state" requirement holds.

---

### Task 5: Manifest changes

**Files:**
- Modify: `manifest.config.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the `identity` permission and the backend's host permission that Tasks 1–4's `chrome.identity`/`fetch` calls need at runtime.

This task is manual-verification-only (a manifest field, verified by the extension actually loading and the sign-in flow in Task 3 actually working — there's no automated test for a manifest permission).

- [ ] **Step 1: Update the permissions and host permissions**

In `manifest.config.ts`, change:

```ts
  permissions: ['sidePanel', 'storage', 'scripting'],
  host_permissions: ['https://claude.ai/*'],
```

to:

```ts
  permissions: ['sidePanel', 'storage', 'scripting', 'identity'],
  host_permissions: ['https://claude.ai/*', 'https://claude-extension-git-main-luxqees-projects.vercel.app/*'],
```

- [ ] **Step 2: Verify the build**

Run: `pnpm run build`
Expected: clean, zero errors. Check `dist/manifest.json` includes both the new permission and the new host permission.

- [ ] **Step 3: Commit**

```bash
git add manifest.config.ts
git commit -m "feat: add identity permission and backend host permission to the manifest"
```

- [ ] **Step 4: Manual verification**

Reload the unpacked extension in `chrome://extensions` (a permissions change requires this, same as any manifest edit) — Chrome may show a notice that the extension's permissions changed. Confirm the sidebar still loads normally, and re-run Task 4's Team-section checklist end to end once more now that `host_permissions` actually covers the backend domain (if Task 4 was verified before this task landed, the `fetch()` call in `org-prompts.ts` would have been silently blocked by the missing host permission — Task 3's sign-in flow itself doesn't need this permission, since `launchWebAuthFlow` is a Chrome-internal flow, not a regular `fetch()`; this step is specifically what makes the org-prompts network call actually reach the API).
