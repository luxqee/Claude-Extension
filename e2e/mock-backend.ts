import type { Page } from '@playwright/test'
import { API_BASE_URL } from '../src/shared/api-base'

// Extends E2E coverage past sign-in WITHOUT a real Clerk account or a live
// backend -- neither belongs in an automated test (real credentials to
// manage, a live org that could be mutated by a flaky run). Instead this
// stubs the two boundaries the extension's own code already isolates for
// exactly this reason: `chrome.identity.launchWebAuthFlow` (the OAuth
// popup) and `fetch` calls to the backend. Everything else -- the real
// ClerkAuthAdapter code, the real render.ts/SettingsPanel/
// ManageOrganisation/TeamSection rendering, the real chrome.storage.local
// session -- runs unmodified. This proves "does the UI do the right thing
// with what the backend returns", which is exactly the class of bug this
// project hit repeatedly (shared tabs not showing, org data mismatches).
// It does NOT prove Clerk or the live backend themselves work -- that
// still needs docs/qa-checklist.md against the real deployment.

export interface OrgScenario {
  email: string
  /** Exact JSON body POST /api/org-session would return. */
  orgSession: unknown
  /** Exact JSON body GET /api/org-prompts would return (snake_case, as
   * the real backend sends it -- see org-prompts.ts). */
  orgPrompts?: unknown
  members?: unknown[]
  analytics?: unknown
  usageSnapshots?: unknown[]
}

const FAR_FUTURE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

export async function mockClerkAndBackend(page: Page, scenario: OrgScenario): Promise<void> {
  // Runs before any page script, so ClerkAuthAdapter always sees this
  // version of the API, never the real one. Reads `state` back out of the
  // authorize URL the app itself built, so the extension's own
  // state-mismatch check (a real anti-CSRF measure) still passes.
  await page.addInitScript(() => {
    const realGetRedirectURL = chrome.identity.getRedirectURL.bind(chrome.identity)
    chrome.identity.launchWebAuthFlow = (details: { url: string }) => {
      const state = new URL(details.url).searchParams.get('state') ?? ''
      return Promise.resolve(`${realGetRedirectURL()}?code=mock-code&state=${encodeURIComponent(state)}`)
    }
  })

  await page.route(`${API_BASE_URL}/**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    switch (pathname) {
      case '/api/auth/session':
        return route.fulfill({
          json: { sessionToken: 'mock-session-token', email: scenario.email, expiresAt: FAR_FUTURE },
        })
      case '/api/org-session':
        return route.fulfill({ json: scenario.orgSession })
      case '/api/org-prompts':
        return route.fulfill({ json: scenario.orgPrompts ?? { org: null, tabs: [], prompts: [] } })
      case '/api/org-members':
        return route.fulfill({ json: { members: scenario.members ?? [] } })
      case '/api/org-analytics':
        return route.fulfill({ json: scenario.analytics ?? { topPrompts: [], perMember: [], dailyRuns: [] } })
      case '/api/org-usage':
        return route.fulfill({ json: { snapshots: scenario.usageSnapshots ?? [] } })
      default:
        // org-tabs / org-members / org-prompts writes, prompt-run,
        // usage-report: every write in this app is a 204 with no body.
        return route.fulfill({ status: 204 })
    }
  })
}
