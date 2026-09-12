import { test, expect } from './fixtures'

// Covers docs/qa-checklist.md sections 1-2 (lifecycle, personal buttons) --
// the parts that need no sign-in, no backend, and no claude.ai tab.

test('starts empty with the add button visible', async ({ sidepanel: page }) => {
  await expect(page.getByText(/no tools in this tab yet/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /add tool/i })).toBeVisible()
})

test('add, edit, and delete a button', async ({ sidepanel: page }) => {
  await page.getByRole('button', { name: /add tool/i }).click()
  await page.getByLabel('Name').fill('My Test Prompt')
  await page.getByRole('textbox', { name: 'Prompt' }).fill('Summarize the above in three bullets.')
  await page.getByRole('button', { name: 'Save' }).click()

  const row = page.getByRole('listitem').filter({ hasText: 'My Test Prompt' })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Name').fill('My Renamed Prompt')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'My Renamed Prompt' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'My Test Prompt' })).toHaveCount(0)

  page.once('dialog', (dialog) => dialog.accept())
  await page
    .getByRole('listitem')
    .filter({ hasText: 'My Renamed Prompt' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByRole('listitem')).toHaveCount(0)
  await expect(page.getByText(/no tools in this tab yet/i)).toBeVisible()
})

test('a skill button shows the / badge and inserts as typed', async ({ sidepanel: page }) => {
  await page.getByRole('button', { name: /add tool/i }).click()
  await page.getByRole('radio', { name: 'Skill' }).check()
  await page.getByLabel('Name').fill('Doc summary')
  await page.getByLabel('Skill invocation').fill('/doc-summary')
  await page.getByRole('button', { name: 'Save' }).click()

  const row = page.getByRole('listitem').filter({ hasText: 'Doc summary' })
  await expect(row).toBeVisible()
  await expect(row.locator('.skill-badge')).toHaveText('/')
})

test('reorders buttons with the keyboard (Arrow Down on the drag handle)', async ({ sidepanel: page }) => {
  for (const name of ['First', 'Second']) {
    await page.getByRole('button', { name: /add tool/i }).click()
    await page.getByLabel('Name').fill(name)
    await page.getByRole('textbox', { name: 'Prompt' }).fill('placeholder text')
    await page.getByRole('button', { name: 'Save' }).click()
  }

  const namesInOrder = () => page.locator('.button-row-name').allInnerTexts()
  await expect.poll(namesInOrder).toEqual(['First', 'Second'])

  await page.getByRole('button', { name: /reorder first/i }).focus()
  await page.keyboard.press('ArrowDown')

  await expect.poll(namesInOrder).toEqual(['Second', 'First'])
})

test('creating a tab and moving a button to it filters the list by tab', async ({ sidepanel: page }) => {
  await page.getByRole('button', { name: /add tool/i }).click()
  await page.getByLabel('Name').fill('General item')
  await page.getByRole('textbox', { name: 'Prompt' }).fill('placeholder text')
  await page.getByRole('button', { name: 'Save' }).click()

  // Add tab -> lands on the tab editor with a fresh "New tab" chip.
  await page.getByRole('button', { name: 'Add tab' }).click()
  const newTabChip = page.getByRole('button', { name: 'Rename New tab' })
  await expect(newTabChip).toBeVisible()
  await newTabChip.click()
  await page.getByLabel(/name for new tab/i).fill('Research')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Back' }).click()

  // Both tabs now show as chips in the main strip; the new one is active
  // (onAddTab switches to it), so the tab we just made should be empty.
  await expect(page.getByRole('tab', { name: 'Research' })).toBeVisible()
  await expect(page.getByText(/no tools in this tab yet/i)).toBeVisible()

  // Move "General item" into Research via its edit form's tab picker.
  await page.getByRole('tab', { name: 'General' }).click()
  await page
    .getByRole('listitem')
    .filter({ hasText: 'General item' })
    .getByRole('button', { name: 'Edit' })
    .click()
  await page.getByRole('button', { name: 'Tab' }).click() // dropdown trigger
  await page.getByRole('option', { name: 'Research' }).click()
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('listitem').filter({ hasText: 'General item' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Research' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'General item' })).toBeVisible()
})
