# Stage 1D: Claude Prompt Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clicking a button's name in the side panel actually insert its prompt into Claude's chat input and send it, with clear inline feedback on success or failure.

**Architecture:** A new `claude-adapter.ts` in the content script owns all Claude-DOM-touching logic (poll for the input, insert text, find/click send or fall back to Enter, confirm the send). The content script wires this to the already-stubbed `INSERT_AND_SEND` message. The side panel gains a per-row run state (`isRunning`/`error`) rendered by `ButtonRow.ts`, driven by a new `onRun` handler in `main.ts` that resolves the active tab, messages the content script, and reflects the result back into that row.

**Tech Stack:** Same as Stage 1B/1C — TypeScript 5, Vite 8, `@crxjs/vite-plugin`, Vitest 4, pnpm. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-stage1d-claude-execution-design.md`

**Note on testability (corrects an over-broad claim in the design spec):** the spec says "`ButtonRow.ts`'s new state rendering are unit-testable... same pattern as the existing Edit/Delete/reorder controls." That existing pattern doesn't actually exist — `vitest.config.ts` runs with `environment: 'node'` (no DOM), and no sidepanel UI file has ever had automated tests; all DOM-construction/wiring code in this project has always been manual-verification-only (see the Stage 1B/1C plan's Testing section). This plan follows the *real* convention: `ButtonRow.ts`, `render.ts`, and `main.ts` changes are manual-verification-only, exactly like every prior UI task. The one genuine new opportunity for real unit tests is `claude-adapter.ts`'s three pure helper functions (`pollFor`, `isSendButtonUsable`, `isInputEmpty`) — they don't touch `document` and are fully testable with plain fake objects and Vitest's fake timers, no new dependency required. Task 2 below covers those with real TDD.

## Global Constraints

- No `tabs` permission — active-tab visibility comes entirely from the `host_permissions: ["https://claude.ai/*"]` already granted in Stage 1B. `chrome.tabs.query`'s `url` field is populated only for tabs matching that pattern; an empty `url` is the signal a tab isn't claude.ai. Do not add the `tabs` permission.
- Confirmed, fixed Claude DOM selectors: chat input `[data-testid="chat-input"]`, send button `button[aria-label="Send message"]`. The `data-trigger-disabled` attribute is a false signal (a tooltip-library artifact) and must never be used to decide whether the send button is usable — only the real `disabled` property / `aria-disabled="true"` attribute count.
- No boundary may fail silently — every failure path (input not found, send not confirmed, no claude.ai tab, content script unreachable) logs to console AND surfaces a specific, human-readable message inline at the row that triggered it.
- Clicking a button's name/label runs it. Edit/Delete/↑/↓ remain separate icon controls; no dedicated "Run" icon is added.
- Inline row errors clear on the next action taken anywhere in the panel, not just actions on that specific row.
- Package manager is pnpm, not npm (see the Stage 1B/1C plan's Global Constraints for why). `pnpm run build` runs `tsc --noEmit` before `vite build` — new code must be strict-mode clean.
- Never build element content for user-supplied strings via `innerHTML` — use `textContent`/`.value`, consistent with every existing UI file.

---

### Task 1: Shared Message Contract

**Files:**
- Create: `src/shared/messages.ts`

**Interfaces:**
- Produces: `InsertAndSendRequest { type: 'INSERT_AND_SEND'; prompt: string }`, `InsertAndSendErrorCode = 'no_claude_tab' | 'no_content_script' | 'input_not_found' | 'send_failed'`, `InsertAndSendResponse = { ok: true } | { ok: false; error: InsertAndSendErrorCode; message: string }`. Every later task imports these types rather than redefining the message shape.

- [ ] **Step 1: Create `src/shared/messages.ts`**

```ts
export interface InsertAndSendRequest {
  type: 'INSERT_AND_SEND'
  prompt: string
}

export type InsertAndSendErrorCode =
  | 'no_claude_tab'
  | 'no_content_script'
  | 'input_not_found'
  | 'send_failed'

export type InsertAndSendResponse =
  | { ok: true }
  | { ok: false; error: InsertAndSendErrorCode; message: string }
```

This file has no runtime logic — it's type-only, so there is nothing to unit test. Do not write a test file for it.

- [ ] **Step 2: Verify the project still builds**

Run: `pnpm run build`
Expected: exits 0 (this file isn't imported anywhere yet, so this just confirms no syntax error).

- [ ] **Step 3: Commit**

```bash
git add src/shared/messages.ts
git commit -m "feat: add shared INSERT_AND_SEND message contract"
```

---

### Task 2: claude-adapter.ts Pure Helpers (TDD)

**Files:**
- Create: `src/content/claude-adapter.ts` (helpers only in this task — `insertAndSend` itself is Task 3)
- Test: `tests/content/claude-adapter.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `pollFor<T>(find: () => T | null, intervalMs: number, timeoutMs: number): Promise<T | null>`, `isSendButtonUsable(button: Pick<HTMLButtonElement, 'disabled' | 'getAttribute'> | null): boolean`, `isInputEmpty(input: Pick<HTMLElement, 'textContent'>): boolean`. Task 3 builds `insertAndSend` on top of these exact signatures.

- [ ] **Step 1: Write the failing tests**

Create `tests/content/claude-adapter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isInputEmpty, isSendButtonUsable, pollFor } from '../../src/content/claude-adapter'

describe('pollFor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when find() returns a value on the first call', async () => {
    const find = vi.fn(() => 'found')
    const result = await pollFor(find, 10, 30)
    expect(result).toBe('found')
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('polls until find() returns a value, then resolves with it', async () => {
    const find = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValueOnce('found')

    const promise = pollFor(find, 10, 100)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    const result = await promise

    expect(result).toBe('found')
    expect(find).toHaveBeenCalledTimes(3)
  })

  it('resolves null after exhausting the timeout without ever finding a value', async () => {
    const find = vi.fn(() => null)
    const promise = pollFor(find, 10, 30)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    const result = await promise

    expect(result).toBeNull()
    expect(find).toHaveBeenCalledTimes(4)
  })
})

describe('isSendButtonUsable', () => {
  it('returns false for null', () => {
    expect(isSendButtonUsable(null)).toBe(false)
  })

  it('returns false when disabled is true', () => {
    expect(isSendButtonUsable({ disabled: true, getAttribute: () => null })).toBe(false)
  })

  it('returns false when aria-disabled is "true"', () => {
    expect(isSendButtonUsable({ disabled: false, getAttribute: () => 'true' })).toBe(false)
  })

  it('returns true when enabled and not aria-disabled', () => {
    expect(isSendButtonUsable({ disabled: false, getAttribute: () => null })).toBe(true)
  })

  it('ignores an unrelated data-trigger-disabled attribute', () => {
    expect(
      isSendButtonUsable({
        disabled: false,
        getAttribute: (name: string) => (name === 'data-trigger-disabled' ? '' : null),
      }),
    ).toBe(true)
  })
})

describe('isInputEmpty', () => {
  it('returns true for empty textContent', () => {
    expect(isInputEmpty({ textContent: '' })).toBe(true)
  })

  it('returns true for whitespace-only textContent', () => {
    expect(isInputEmpty({ textContent: '   \n  ' })).toBe(true)
  })

  it('returns false for non-empty textContent', () => {
    expect(isInputEmpty({ textContent: 'hello' })).toBe(false)
  })

  it('returns true for null textContent', () => {
    expect(isInputEmpty({ textContent: null })).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- claude-adapter`
Expected: FAIL — `Cannot find module '../../src/content/claude-adapter'`

- [ ] **Step 3: Create `src/content/claude-adapter.ts` with just the three helpers**

```ts
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function pollFor<T>(
  find: () => T | null,
  intervalMs: number,
  timeoutMs: number,
): Promise<T | null> {
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = find()
    if (result) return result
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs)
    }
  }
  return null
}

export function isSendButtonUsable(
  button: Pick<HTMLButtonElement, 'disabled' | 'getAttribute'> | null,
): boolean {
  if (!button) return false
  if (button.disabled) return false
  if (button.getAttribute('aria-disabled') === 'true') return false
  return true
}

export function isInputEmpty(input: Pick<HTMLElement, 'textContent'>): boolean {
  return (input.textContent ?? '').trim().length === 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- claude-adapter`
Expected: PASS, all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/content/claude-adapter.ts tests/content/claude-adapter.test.ts
git commit -m "feat: add claude-adapter pure helpers (pollFor, isSendButtonUsable, isInputEmpty)"
```

---

### Task 3: claude-adapter.ts — insertAndSend Orchestration

**Files:**
- Modify: `src/content/claude-adapter.ts` (add to the file from Task 2 — do not remove the existing exports)

**Interfaces:**
- Consumes: `pollFor`, `isSendButtonUsable`, `isInputEmpty` from Task 2 (same file); `InsertAndSendResponse` from Task 1.
- Produces: `insertAndSend(prompt: string): Promise<InsertAndSendResponse>`. Task 4's content script calls this exact function.

- [ ] **Step 1: Append the DOM query helpers and `insertAndSend` to `src/content/claude-adapter.ts`**

Add these imports at the top of the file (above the existing `sleep` function):

```ts
import type { InsertAndSendResponse } from '../shared/messages'
```

Add this below the existing `isInputEmpty` function:

```ts
const CHAT_INPUT_SELECTOR = '[data-testid="chat-input"]'
const SEND_BUTTON_SELECTOR = 'button[aria-label="Send message"]'

const INPUT_POLL_INTERVAL_MS = 150
const INPUT_POLL_TIMEOUT_MS = 3000
const SEND_POLL_INTERVAL_MS = 100
const SEND_POLL_TIMEOUT_MS = 800
const CONFIRM_POLL_INTERVAL_MS = 100
const CONFIRM_POLL_TIMEOUT_MS = 800

function findChatInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CHAT_INPUT_SELECTOR)
}

function findUsableSendButton(): HTMLButtonElement | null {
  const button = document.querySelector<HTMLButtonElement>(SEND_BUTTON_SELECTOR)
  return isSendButtonUsable(button) ? button : null
}

function dispatchEnterKey(input: HTMLElement): void {
  const eventInit: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  }
  input.dispatchEvent(new KeyboardEvent('keydown', eventInit))
  input.dispatchEvent(new KeyboardEvent('keyup', eventInit))
}

export async function insertAndSend(prompt: string): Promise<InsertAndSendResponse> {
  const input = await pollFor(findChatInput, INPUT_POLL_INTERVAL_MS, INPUT_POLL_TIMEOUT_MS)
  if (!input) {
    console.error('[Claude Tools] chat input not found within timeout')
    return {
      ok: false,
      error: 'input_not_found',
      message: "Couldn't find Claude's chat box. Try reloading the page.",
    }
  }

  input.focus()
  document.execCommand('insertText', false, prompt)

  const sendButton = await pollFor(findUsableSendButton, SEND_POLL_INTERVAL_MS, SEND_POLL_TIMEOUT_MS)
  if (sendButton) {
    sendButton.click()
  } else {
    console.warn('[Claude Tools] no usable send button found, falling back to Enter key')
    dispatchEnterKey(input)
  }

  const cleared = await pollFor(
    () => (isInputEmpty(input) ? true : null),
    CONFIRM_POLL_INTERVAL_MS,
    CONFIRM_POLL_TIMEOUT_MS,
  )
  if (!cleared) {
    console.error('[Claude Tools] could not confirm the prompt was sent')
    return {
      ok: false,
      error: 'send_failed',
      message: "Inserted the prompt but couldn't confirm it sent. Check the Claude tab.",
    }
  }

  return { ok: true }
}
```

`insertAndSend` is not unit-testable — it depends entirely on live claude.ai DOM structure (`document.querySelector` against real markup). This is expected and matches every other Claude-DOM-touching piece of this project; it's verified manually once Task 5 makes it reachable end-to-end.

- [ ] **Step 2: Verify the project builds and existing tests still pass**

Run: `pnpm test`
Expected: PASS, still 26 tests (15 from Stage 1B/1C + 11 from Task 2 — this task adds no new tests).

Run: `pnpm run build`
Expected: exits 0, no TypeScript errors (this is the real check that `insertAndSend`'s DOM-typed code compiles correctly against `@types/chrome`/`lib.dom.d.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/content/claude-adapter.ts
git commit -m "feat: add insertAndSend DOM orchestration to claude-adapter"
```

---

### Task 4: Wire the Content Script to claude-adapter

**Files:**
- Modify: `src/content/content-script.ts` (full replace)

**Interfaces:**
- Consumes: `insertAndSend` from Task 3; `InsertAndSendRequest` from Task 1.
- Produces: a working `INSERT_AND_SEND` message handler — the `not_implemented` stub is gone.

- [ ] **Step 1: Replace `src/content/content-script.ts`**

```ts
import { insertAndSend } from './claude-adapter'
import type { InsertAndSendRequest } from '../shared/messages'

console.log('[Claude Tools] content script loaded on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message as InsertAndSendRequest).type !== 'INSERT_AND_SEND') return undefined
  const { prompt } = message as InsertAndSendRequest
  insertAndSend(prompt)
    .then(sendResponse)
    .catch((error) => {
      console.error('[Claude Tools] unexpected error during insertAndSend', error)
      sendResponse({
        ok: false,
        error: 'send_failed',
        message: 'Something went wrong inserting the prompt. Check the console for details.',
      })
    })
  return true
})
```

- [ ] **Step 2: Build and verify**

Run: `pnpm run build`
Expected: exits 0.

Manual check (same limitation as every prior content-script task — no real Chrome browser available in this environment, if you're an agent executing this): open `https://claude.ai`, open DevTools console, confirm `[Claude Tools] content script loaded on https://claude.ai/...` still appears. Full behavior verification happens in Task 5/6 once the side panel can actually trigger this.

- [ ] **Step 3: Commit**

```bash
git add src/content/content-script.ts
git commit -m "feat: wire content script INSERT_AND_SEND handler to claude-adapter"
```

---

### Task 5: Run Trigger + Row State UI + main.ts Wiring

This task is intentionally larger than the others: `ButtonRow.ts`/`render.ts`/`style.css` and `main.ts` are producer/consumer of the same new interfaces (`RunState`, the extra `renderApp` parameter, the expanded `ButtonRowContext`/`RenderContext`). Splitting them into separate tasks (as an earlier draft of this plan did) leaves the build broken between them for no reviewable benefit — a reviewer can't meaningfully approve "half a wired feature." They're one task here, same as Stage 1B/1C's Task 7 bundled its row/form/main.ts changes for the same reason.

**Files:**
- Modify: `src/sidepanel/ButtonRow.ts` (full replace)
- Modify: `src/sidepanel/render.ts` (full replace)
- Modify: `src/sidepanel/style.css`
- Modify: `src/sidepanel/main.ts` (full replace)

**Interfaces:**
- Consumes: `Button` from `../shared/types` (unchanged); `InsertAndSendRequest`, `InsertAndSendResponse` from `../shared/messages` (Task 1); `chrome.tabs.query`/`chrome.tabs.sendMessage` (no new permission).
- Produces: `ButtonRowContext` gains `isRunning: boolean`, `runError: string | null`, `onRun: () => void`. `renderButtonRow` renders the button's name as a clickable, disableable control and an optional status line. `RenderContext` gains `onRun: (button: Button) => void`. `renderApp` gains a new `runState: Map<string, RunState>` parameter (inserted before `context`), and exports `RunState { isRunning: boolean; error: string | null }`. `main.ts` constructs and passes this map, and this task is the last one before the feature is reachable in a real browser.

- [ ] **Step 1: Replace `src/sidepanel/ButtonRow.ts`**

```ts
import type { Button } from '../shared/types'

export interface ButtonRowContext {
  isFirst: boolean
  isLast: boolean
  isRunning: boolean
  runError: string | null
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function renderButtonRow(button: Button, context: ButtonRowContext): HTMLElement {
  const item = document.createElement('li')
  item.className = 'button-row-wrapper'

  const row = document.createElement('div')
  row.className = 'button-row'

  const name = document.createElement('button')
  name.type = 'button'
  name.className = 'button-row-name'
  name.textContent = button.name
  name.setAttribute('aria-label', `Run ${button.name}`)
  name.disabled = context.isRunning
  name.addEventListener('click', context.onRun)
  row.appendChild(name)

  const controls = document.createElement('div')
  controls.className = 'button-row-controls'

  const upButton = document.createElement('button')
  upButton.type = 'button'
  upButton.className = 'icon-button'
  upButton.textContent = '↑'
  upButton.setAttribute('aria-label', `Move ${button.name} up`)
  upButton.disabled = context.isFirst
  upButton.addEventListener('click', context.onMoveUp)
  controls.appendChild(upButton)

  const downButton = document.createElement('button')
  downButton.type = 'button'
  downButton.className = 'icon-button'
  downButton.textContent = '↓'
  downButton.setAttribute('aria-label', `Move ${button.name} down`)
  downButton.disabled = context.isLast
  downButton.addEventListener('click', context.onMoveDown)
  controls.appendChild(downButton)

  const editButton = document.createElement('button')
  editButton.type = 'button'
  editButton.className = 'icon-button'
  editButton.textContent = 'Edit'
  editButton.setAttribute('aria-label', `Edit ${button.name}`)
  editButton.addEventListener('click', context.onEdit)
  controls.appendChild(editButton)

  const deleteButton = document.createElement('button')
  deleteButton.type = 'button'
  deleteButton.className = 'icon-button icon-button-danger'
  deleteButton.textContent = 'Delete'
  deleteButton.setAttribute('aria-label', `Delete ${button.name}`)
  deleteButton.addEventListener('click', context.onDelete)
  controls.appendChild(deleteButton)

  row.appendChild(controls)
  item.appendChild(row)

  if (context.isRunning) {
    const status = document.createElement('p')
    status.className = 'button-row-status'
    status.textContent = 'Running…'
    item.appendChild(status)
  } else if (context.runError) {
    const status = document.createElement('p')
    status.className = 'button-row-status button-row-status-error'
    status.textContent = context.runError
    item.appendChild(status)
  }

  return item
}
```

- [ ] **Step 2: Replace `src/sidepanel/render.ts`**

```ts
import type { Button } from '../shared/types'
import { renderButtonRow } from './ButtonRow'
import { renderEditForm } from './EditForm'

export type View = { mode: 'list' } | { mode: 'form'; button: Button | null }

export interface RunState {
  isRunning: boolean
  error: string | null
}

export interface RenderContext {
  onRun: (button: Button) => void
  onEdit: (button: Button) => void
  onDelete: (button: Button) => void
  onMoveUp: (button: Button) => void
  onMoveDown: (button: Button) => void
  onAddClick: () => void
  onSave: (data: { id: string | null; name: string; prompt: string }) => void
  onCancel: () => void
}

export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  context: RenderContext,
): void {
  root.innerHTML = ''

  if (view.mode === 'form') {
    root.appendChild(renderEditForm(view.button, { onSave: context.onSave, onCancel: context.onCancel }))
    return
  }

  const header = document.createElement('div')
  header.className = 'toolbar'
  const addButton = document.createElement('button')
  addButton.type = 'button'
  addButton.className = 'add-button'
  addButton.textContent = '+ Add tool'
  addButton.addEventListener('click', context.onAddClick)
  header.appendChild(addButton)
  root.appendChild(header)

  if (buttons.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'No tools yet. Click "Add tool" to create your first one.'
    root.appendChild(empty)
    return
  }

  const list = document.createElement('ul')
  list.className = 'button-list'
  buttons.forEach((button, index) => {
    const state = runState.get(button.id) ?? { isRunning: false, error: null }
    list.appendChild(
      renderButtonRow(button, {
        isFirst: index === 0,
        isLast: index === buttons.length - 1,
        isRunning: state.isRunning,
        runError: state.error,
        onRun: () => context.onRun(button),
        onEdit: () => context.onEdit(button),
        onDelete: () => context.onDelete(button),
        onMoveUp: () => context.onMoveUp(button),
        onMoveDown: () => context.onMoveDown(button),
      }),
    )
  })
  root.appendChild(list)
}
```

- [ ] **Step 3: Update `src/sidepanel/style.css`**

Replace the existing `.button-row` and `.button-row-name` rules (find them — `.button-row` currently has `display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid #d8d8d8; border-radius: 8px;` and `.button-row-name` currently has `font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) with:

```css
.button-row-wrapper {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.button-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
}

.button-row-name {
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

.button-row-name:disabled {
  opacity: 0.6;
  cursor: default;
}

.button-row-status {
  margin: 0;
  padding: 0 10px;
  font-size: 12px;
  color: #6b6b6b;
}

.button-row-status-error {
  color: #b3261e;
}
```

Everything else in the file (`.button-list`, `.toolbar`, `.add-button`, `.icon-button` and its variants, `.edit-form*`) stays unchanged.

- [ ] **Step 4: Replace `src/sidepanel/main.ts`**

```ts
import { ToolService } from '../shared/tool-service'
import { ChromeLocalStorageAdapter } from '../shared/storage/chrome-local-adapter'
import { renderApp, type View, type RunState } from './render'
import type { Button } from '../shared/types'
import type { InsertAndSendRequest, InsertAndSendResponse } from '../shared/messages'

const toolService = new ToolService(new ChromeLocalStorageAdapter())
const root = document.getElementById('app')

if (!root) {
  throw new Error('[Claude Tools] sidepanel root element (#app) is missing')
}

let view: View = { mode: 'list' }
const runState = new Map<string, RunState>()

function clearRunErrors(): void {
  for (const [id, state] of runState) {
    if (state.error && !state.isRunning) {
      runState.delete(id)
    }
  }
}

async function refresh(root: HTMLElement): Promise<void> {
  try {
    const buttons = await toolService.listButtons()
    renderApp(root, buttons, view, runState, {
      onRun: async (button: Button) => {
        clearRunErrors()
        runState.set(button.id, { isRunning: true, error: null })
        await refresh(root)

        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab?.id || !tab.url) {
            console.warn('[Claude Tools] no active claude.ai tab to run against')
            runState.set(button.id, { isRunning: false, error: 'Open claude.ai to use this tool.' })
            await refresh(root)
            return
          }

          const request: InsertAndSendRequest = { type: 'INSERT_AND_SEND', prompt: button.prompt }
          let response: InsertAndSendResponse
          try {
            response = await chrome.tabs.sendMessage<InsertAndSendRequest, InsertAndSendResponse>(
              tab.id,
              request,
            )
          } catch (error) {
            console.error('[Claude Tools] failed to reach content script', error)
            runState.set(button.id, { isRunning: false, error: 'Reload the Claude tab and try again.' })
            await refresh(root)
            return
          }

          if (response.ok) {
            runState.set(button.id, { isRunning: false, error: null })
          } else {
            console.error('[Claude Tools] run failed', response.error, response.message)
            runState.set(button.id, { isRunning: false, error: response.message })
          }
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] unexpected error running button', error)
          runState.set(button.id, {
            isRunning: false,
            error: 'Something went wrong running that tool. Check the console for details.',
          })
          await refresh(root)
        }
      },
      onAddClick: () => {
        clearRunErrors()
        view = { mode: 'form', button: null }
        void refresh(root)
      },
      onEdit: (button: Button) => {
        clearRunErrors()
        view = { mode: 'form', button }
        void refresh(root)
      },
      onDelete: async (button: Button) => {
        const confirmed = window.confirm(`Delete "${button.name}"? This cannot be undone.`)
        if (!confirmed) return
        clearRunErrors()
        try {
          await toolService.deleteButton(button.id)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to delete button', error)
          root.textContent = 'Something went wrong deleting that tool. Check the console for details.'
        }
      },
      onMoveUp: async (button: Button) => {
        clearRunErrors()
        const ids = buttons.map((b) => b.id)
        const index = ids.indexOf(button.id)
        if (index <= 0) return
        ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
        try {
          await toolService.reorderButtons(ids)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder buttons', error)
          root.textContent = 'Something went wrong reordering your tools. Check the console for details.'
        }
      },
      onMoveDown: async (button: Button) => {
        clearRunErrors()
        const ids = buttons.map((b) => b.id)
        const index = ids.indexOf(button.id)
        if (index === -1 || index >= ids.length - 1) return
        ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
        try {
          await toolService.reorderButtons(ids)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder buttons', error)
          root.textContent = 'Something went wrong reordering your tools. Check the console for details.'
        }
      },
      onSave: async (data) => {
        if (!data.name || !data.prompt) return
        clearRunErrors()
        try {
          if (data.id) {
            await toolService.updateButton(data.id, { name: data.name, prompt: data.prompt })
          } else {
            await toolService.createButton(data.name, data.prompt)
          }
          view = { mode: 'list' }
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to save button', error)
          root.textContent = 'Something went wrong saving that tool. Check the console for details.'
        }
      },
      onCancel: () => {
        clearRunErrors()
        view = { mode: 'list' }
        void refresh(root)
      },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to load buttons', error)
    root.textContent = 'Something went wrong loading your tools. Check the console for details.'
  }
}

void refresh(root)
```

- [ ] **Step 5: Update `src/sidepanel/style.css`**

Replace the existing `.button-row` and `.button-row-name` rules (find them — `.button-row` currently has `display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid #d8d8d8; border-radius: 8px;` and `.button-row-name` currently has `font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) with:

```css
.button-row-wrapper {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.button-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
}

.button-row-name {
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

.button-row-name:disabled {
  opacity: 0.6;
  cursor: default;
}

.button-row-status {
  margin: 0;
  padding: 0 10px;
  font-size: 12px;
  color: #6b6b6b;
}

.button-row-status-error {
  color: #b3261e;
}
```

Everything else in the file (`.button-list`, `.toolbar`, `.add-button`, `.icon-button` and its variants, `.edit-form*`) stays unchanged.

- [ ] **Step 6: Build and verify**

Run: `pnpm run build`
Expected: exits 0, no TypeScript errors — this confirms `ButtonRow.ts`, `render.ts`, and `main.ts`'s new signatures all line up correctly across the whole task.

Run: `pnpm test`
Expected: PASS, still 26 tests (no test changes in this task).

- [ ] **Step 7: Manual end-to-end walkthrough**

This is the first point in Stage 1D where the full feature is reachable. If you have access to a real Chrome browser:

1. `pnpm run build`, reload the unpacked extension in `chrome://extensions`.
2. Open `https://claude.ai`, open the side panel, create a button with a short test prompt (e.g. name "Test", prompt "Say hello in one word.").
3. Click the button's name. Confirm: the row dims/disables briefly, the prompt text appears in Claude's chat input, the message sends, and Claude responds normally.
4. Confirm the row returns to normal (no lingering "Running…" or error) after a successful run.

If you're an agent executing this plan and have no real Chrome browser available (the case throughout this project so far), do not fabricate having performed this check. Report explicitly that Step 7 could not be performed and why, and rely on the final acceptance task's manual QA pass being run by the human afterward.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/ButtonRow.ts src/sidepanel/render.ts src/sidepanel/style.css src/sidepanel/main.ts
git commit -m "feat: add clickable run trigger, per-row run state, and onRun wiring"
```

---

### Task 6: Full Stage 1D Acceptance Pass

**Files:** none (verification only)

**Interfaces:** none — this task exercises everything built in Tasks 1–5 together.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm test`
Expected: PASS, all 26 tests green.

- [ ] **Step 2: Run the build**

Run: `pnpm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Walk the acceptance checklist manually**

Verify each of the following (requires a real Chrome browser):

- [ ] Clicking a button's name on a claude.ai tab inserts its prompt into the chat input and sends it; Claude responds normally.
- [ ] While a run is in progress, the row is visibly dimmed/disabled and a second click on the same row does nothing (no double-send).
- [ ] After a successful run, the row returns to normal with no lingering status text.
- [ ] Clicking a button while the active tab is NOT claude.ai shows "Open claude.ai to use this tool." inline at that row, and nothing else happens (no tab switch, no new tab).
- [ ] Clicking a button on a claude.ai tab that was open before the extension was last installed/reloaded (so the content script was never injected) shows "Reload the Claude tab and try again." — then, after reloading that tab, the same button click succeeds.
- [ ] Triggering an error on one row (e.g. the wrong-tab case), then performing any other action anywhere in the panel (edit a different button, add a new one, reorder), clears that error message.
- [ ] A long prompt (several paragraphs) inserts correctly and sends without truncation.
- [ ] Running two different buttons in quick succession — the second click while the first is still "Running…" — is either queued sensibly or clearly still shows correct per-row state for both (no shared/bleeding state between rows).
- [ ] Existing Stage 1B/1C functionality (create/edit/delete/reorder) still works unchanged alongside the new run behavior.

- [ ] **Step 4: Record any failures**

If any checklist item fails, do not mark this task complete — identify which task's code is responsible and fix there before considering Stage 1D done.

- [ ] **Step 5: No commit for this task**

Verification-only, no file changes expected. If everything passes, Stage 1D is complete as of Task 5's commit.
