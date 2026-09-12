import { defineConfig } from '@playwright/test'

// End-to-end tests drive the REAL unpacked extension in a real Chromium --
// not a mock DOM. Chrome extensions require a headed (or new-headless)
// browser and a persistent context; see e2e/fixtures.ts for how that's
// wired up. `pnpm run build` must have produced `dist/` before running
// these (`pnpm run e2e` does that for you).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false, // each test launches its own browser+profile; keep it light
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
})
