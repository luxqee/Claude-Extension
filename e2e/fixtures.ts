import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSION_PATH = fileURLToPath(new URL('../dist', import.meta.url))

// Pinned via `key` in manifest.config.ts -- identical on every machine and
// every build, which is the whole point of pinning it. Loading the real
// unpacked dist/ here is how we know this value is actually still right,
// not just documentation of an intent.
export const EXTENSION_ID = 'fhaeedmmhjjkhnopifppigddjbbmdegh'

export const test = base.extend<{ sidepanel: Page }, { context: BrowserContext }>({
  // One fresh, disposable profile per test -- chrome.storage.local isn't
  // shared between tests, so button/tab state from one test can't leak
  // into another. Slower than reusing a context, correct is worth it here.
  context: [
    async ({}, use) => {
      const userDataDir = mkdtempSync(join(tmpdir(), 'aire-ext-e2e-'))
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
      })
      await use(context)
      await context.close()
      rmSync(userDataDir, { recursive: true, force: true })
    },
    { scope: 'test' },
  ],

  // The side panel is just an extension page at this URL -- opening it as
  // a normal tab (rather than through Chrome's side-panel docking UI,
  // which Playwright can't drive) exercises the exact same DOM/JS.
  sidepanel: async ({ context }, use) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${EXTENSION_ID}/src/sidepanel/index.html`)
    await page.waitForSelector('.wordmark')
    await use(page)
  },
})

export { expect } from '@playwright/test'
