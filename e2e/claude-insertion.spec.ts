import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// Runs the REAL, exact content-script.ts bundle that ships in the
// extension (same file, same hash) against a local fixture page -- not
// claude.ai itself. Why not the real site: claude.ai requires a signed-in
// Anthropic account (real credentials in a test suite, exactly what
// mock-backend.ts avoids for Clerk), and Chrome only auto-injects a
// content script into a page matching the manifest's declared host
// (https://claude.ai/*), which a local fixture can never satisfy. So this
// manually loads the real bundle via page.addScriptTag instead -- the
// only piece that's ours to fake is `chrome.runtime` (content scripts get
// it from the browser; a plain page never does), captured here just well
// enough to observe what the real code does with it.
//
// Honest limit: the fixture's DOM is OUR approximation of claude.ai's
// chat input (`[data-testid="chat-input"]`, contenteditable). If Anthropic
// changes that structure, this test keeps passing while the real
// extension breaks -- docs/qa-checklist.md against the live site is what
// catches that class of drift; this catches regressions in OUR insertion/
// send-detection logic, which is the more common failure in practice.

const CONTENT_SCRIPT_PATH = fileURLToPath(
  new URL(
    `../dist/${
      (JSON.parse(readFileSync(fileURLToPath(new URL('../dist/manifest.json', import.meta.url)), 'utf8')) as {
        content_scripts: { js: string[] }[]
      }).content_scripts[0].js[0]
    }`,
    import.meta.url,
  ),
)

const FIXTURE_HTML = `
  <div data-testid="sidebar-recents"></div>
  <div data-testid="chat-input" contenteditable="true" role="textbox"></div>
`

/** Minimal `chrome.runtime` -- just enough for content-script.ts's two
 * onMessage.addListener calls and its one sendMessage call to not throw.
 * Real content scripts get this from the browser; a plain page never
 * does, so this is the one thing here that isn't the real platform. */
function fakeChromeRuntime(): void {
  const w = window as unknown as { __listeners: unknown[]; __sentMessages: unknown[]; chrome: unknown }
  w.__listeners = []
  w.__sentMessages = []
  w.chrome = {
    runtime: {
      onMessage: { addListener: (fn: unknown) => w.__listeners.push(fn) },
      sendMessage: (message: unknown) => {
        w.__sentMessages.push(message)
        return Promise.resolve()
      },
    },
  }
}

/** Loads the real content-script bundle onto an already-set-content page. */
async function loadContentScript(page: Page): Promise<void> {
  await page.evaluate(fakeChromeRuntime)
  await page.addScriptTag({ path: CONTENT_SCRIPT_PATH })
}

type InsertPromptResponse = { ok: true } | { ok: false; error: string; message: string }

/** Invokes content-script.ts's real INSERT_PROMPT listener (the first of
 * its two onMessage.addListener calls) exactly as chrome.runtime would,
 * with sendResponse as a callback this awaits. */
async function sendInsertPrompt(
  page: Page,
  message: { type: 'INSERT_PROMPT'; prompt: string; runToken?: string },
): Promise<InsertPromptResponse> {
  return page.evaluate((msg) => {
    return new Promise<InsertPromptResponse>((resolve) => {
      const w = window as unknown as {
        __listeners: ((msg: unknown, sender: unknown, sendResponse: (r: InsertPromptResponse) => void) => void)[]
      }
      w.__listeners[0](msg, {}, resolve)
    })
  }, message)
}

test('the real content-script bundle inserts a prompt into the real chat-input selector', async ({ context }) => {
  const page = await context.newPage()
  await page.setContent(FIXTURE_HTML)
  await loadContentScript(page)

  const response = await sendInsertPrompt(page, {
    type: 'INSERT_PROMPT',
    prompt: 'Hello from a real test',
    runToken: 'tok-1',
  })

  expect(response).toEqual({ ok: true })
  await expect(page.locator('[data-testid="chat-input"]')).toHaveText('Hello from a real test')
})

test('a missing chat input is reported as a clean error, not a crash', async ({ context }) => {
  const page = await context.newPage()
  await page.setContent('<div data-testid="sidebar-recents"></div>') // no chat-input at all
  await loadContentScript(page)

  const response = await sendInsertPrompt(page, { type: 'INSERT_PROMPT', prompt: 'x' })

  expect(response.ok).toBe(false)
  expect((response as { error: string }).error).toBe('input_not_found')
})

test('sending the message (clearing the input after a hold) reports PROMPT_SENT for analytics', async ({
  context,
}) => {
  const page = await context.newPage()
  await page.setContent(FIXTURE_HTML)
  await loadContentScript(page)

  await sendInsertPrompt(page, { type: 'INSERT_PROMPT', prompt: 'Send me', runToken: 'tok-2' })
  await expect(page.locator('[data-testid="chat-input"]')).toHaveText('Send me')

  // Real claude.ai clears the input once the message is actually sent --
  // simulate that after the 250ms hold threshold watchForSend requires.
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    document.querySelector('[data-testid="chat-input"]')!.textContent = ''
  })

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __sentMessages: unknown[] }).__sentMessages))
    .toContainEqual({ type: 'PROMPT_SENT', runToken: 'tok-2' })
})
