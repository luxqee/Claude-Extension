import { test, expect } from './fixtures'

// Covers docs/qa-checklist.md section 4 (persistence): chrome.storage.local
// survives a page reload -- the closest an extension page gets to
// "reopen the sidebar" / "reload the extension" without actually
// restarting the browser.

test('buttons and tabs survive a reload of the side panel', async ({ sidepanel: page }) => {
  await page.getByRole('button', { name: /add tool/i }).click()
  await page.getByLabel('Name').fill('Survives reload')
  await page.getByRole('textbox', { name: 'Prompt' }).fill('still here after reload')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Survives reload' })).toBeVisible()

  await page.reload()
  await page.waitForSelector('.wordmark')

  await expect(page.getByRole('listitem').filter({ hasText: 'Survives reload' })).toBeVisible()
})
