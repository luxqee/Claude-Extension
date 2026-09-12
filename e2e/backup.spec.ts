import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures-data', import.meta.url))

// Covers docs/qa-checklist.md section 3 (backup): the real Export button
// producing a real browser download, and Import restoring from a file.

test('export downloads a valid v2 backup of the current buttons', async ({ sidepanel: page }) => {
  await page.getByRole('button', { name: /add tool/i }).click()
  await page.getByLabel('Name').fill('Exported Prompt')
  await page.getByRole('textbox', { name: 'Prompt' }).fill('some text')
  await page.getByRole('button', { name: 'Save' }).click()

  await page.getByRole('button', { name: 'Settings' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export tools' }).click()
  const download = await downloadPromise

  const filePath = await download.path()
  const content = JSON.parse(await readFile(filePath!, 'utf8')) as {
    version: number
    tools: { name: string; prompt: string }[]
  }
  expect(content.version).toBe(2)
  expect(content.tools.some((t) => t.name === 'Exported Prompt' && t.prompt === 'some text')).toBe(true)
})

test('import adds buttons from a backup file without touching existing ones', async ({ sidepanel: page }) => {
  await page.getByRole('button', { name: /add tool/i }).click()
  await page.getByLabel('Name').fill('Already here')
  await page.getByRole('textbox', { name: 'Prompt' }).fill('pre-existing')
  await page.getByRole('button', { name: 'Save' }).click()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.settings-file-input').setInputFiles(join(FIXTURE_DIR, 'sample-backup.json'))
  await expect(page.locator('.settings-success')).toHaveText(/imported 2 tools/i)

  await page.getByRole('button', { name: /back/i }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Already here' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Imported One' })).toBeVisible()
  const skillRow = page.getByRole('listitem').filter({ hasText: 'Imported Two' })
  await expect(skillRow).toBeVisible()
  await expect(skillRow.locator('.skill-badge')).toHaveText('/')
})

test('a corrupt import file leaves existing buttons untouched and shows an error', async ({ sidepanel: page }) => {
  await page.getByRole('button', { name: /add tool/i }).click()
  await page.getByLabel('Name').fill('Survivor')
  await page.getByRole('textbox', { name: 'Prompt' }).fill('should not be lost')
  await page.getByRole('button', { name: 'Save' }).click()

  await page.getByRole('button', { name: 'Settings' }).click()
  const badFile = join(FIXTURE_DIR, 'corrupt.json')
  await page.locator('.settings-file-input').setInputFiles(badFile)
  await expect(page.locator('.settings-error')).toHaveText(/valid json/i)

  await page.getByRole('button', { name: /back/i }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Survivor' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(1)
})
