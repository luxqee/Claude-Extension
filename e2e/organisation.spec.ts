import { test, expect, EXTENSION_ID } from './fixtures'
import { mockClerkAndBackend, type OrgScenario } from './mock-backend'
import type { Page, BrowserContext } from '@playwright/test'

// Extends E2E past sign-in via mocked Clerk + backend responses -- see
// mock-backend.ts for exactly what is and isn't real here. Mocks must be
// installed before the page's first navigation, so every test opens its
// own fresh page rather than using the `sidepanel` fixture.

async function openMockedSidepanel(context: BrowserContext, scenario: OrgScenario): Promise<Page> {
  const page = await context.newPage()
  await mockClerkAndBackend(page, scenario)
  await page.goto(`chrome-extension://${EXTENSION_ID}/src/sidepanel/index.html`)
  await page.waitForSelector('.wordmark')
  return page
}

test('signing in as a director shows shared prompts, roster, and analytics', async ({ context }) => {
  const page = await openMockedSidepanel(context, {
    email: 'director@acme.test',
    orgSession: { state: 'active', org: { id: 'org-1', name: 'Acme Inc' }, role: 'director' },
    orgPrompts: {
      org: { name: 'Acme Inc' },
      tabs: [{ id: 'tab-1', name: 'General', emoji: null, sort_order: 0 }],
      prompts: [
        {
          id: 'p-1',
          name: 'Shared prompt',
          prompt_text: 'Summarize the above.',
          type: 'prompt',
          tab_id: 'tab-1',
          sort_order: 0,
        },
      ],
    },
    members: [
      { email: 'director@acme.test', role: 'director', status: 'active', createdAt: new Date().toISOString() },
      { email: 'newperson@acme.test', role: 'member', status: 'pending', createdAt: new Date().toISOString() },
    ],
    analytics: {
      topPrompts: [{ promptId: 'p-1', name: 'Shared prompt', runCount: 4 }],
      perMember: [{ email: 'director@acme.test', runCount: 4, lastUsedAt: new Date().toISOString() }],
      dailyRuns: [],
    },
  })

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.settings-hint').getByText('Signed in as director@acme.test')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage Organisation' })).toBeVisible()

  // The main list's Team section shows the shared prompt too.
  await page.getByRole('button', { name: /back/i }).click()
  await expect(page.getByText('Acme Inc')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Shared prompt' })).toBeVisible()

  // Manage Organisation: roster (including the pending member), the
  // shared prompt, and analytics all render from the mocked responses.
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Manage Organisation' }).click()
  const pendingRow = page.getByRole('listitem').filter({ hasText: 'newperson@acme.test' })
  await expect(pendingRow).toBeVisible()
  await expect(pendingRow.getByText('Pending')).toBeVisible()
  // Appears twice by design here: once in the prompt-management list,
  // once in the Top prompts analytics list -- both are real, so just
  // confirm the data made it to the screen at all.
  await expect(page.getByRole('listitem').filter({ hasText: 'Shared prompt' })).toHaveCount(2)
  await expect(page.getByText('4', { exact: true })).toBeVisible() // the Prompt runs stat tile
})

test('a plain member sees the Team section but not Manage Organisation, and can leave', async ({ context }) => {
  const page = await openMockedSidepanel(context, {
    email: 'member@acme.test',
    orgSession: { state: 'active', org: { id: 'org-1', name: 'Acme Inc' }, role: 'member' },
    orgPrompts: {
      org: { name: 'Acme Inc' },
      tabs: [{ id: 'tab-1', name: 'General', emoji: null, sort_order: 0 }],
      prompts: [
        { id: 'p-1', name: 'Team prompt', prompt_text: 'x', type: 'prompt', tab_id: 'tab-1', sort_order: 0 },
      ],
    },
  })

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Member of Acme Inc.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage Organisation' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Leave organisation' })).toBeVisible()

  await page.getByRole('button', { name: /back/i }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Team prompt' })).toBeVisible()
})

test('a pending invitee sees a waiting message and can cancel', async ({ context }) => {
  const page = await openMockedSidepanel(context, {
    email: 'waiting@acme.test',
    orgSession: { state: 'pending', org: { id: 'org-1', name: 'Acme Inc' } },
  })

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Waiting for approval from Acme Inc.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible()
})
