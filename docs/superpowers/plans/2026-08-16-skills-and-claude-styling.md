# Skill Buttons + Claude-Matched Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a distinct "skill" button type alongside plain prompts, and restyle the side panel to visually match claude.ai's own fonts and colors.

**Architecture:** `Button` gains a `type: 'prompt' | 'skill'` field that flows through the existing storage/service/backup layers with graceful defaulting for data saved before this change. The UI layer (`EditForm.ts`, `ButtonRow.ts`) gets a small toggle and a badge; no new insertion logic is needed since a skill's "prompt" text (its slash-invocation) is typed into Claude's chat box by the exact same `insertPrompt()` mechanism Stage 1D already built. `style.css` is rewritten around a small set of CSS custom-property color tokens (light values in `:root`, dark overrides in a `prefers-color-scheme` media query) populated with claude.ai's own resolved design-system values, plus claude.ai's documented font fallback stack and a consistent type scale.

**Tech Stack:** Same as prior stages — TypeScript 5, Vite 8, `@crxjs/vite-plugin`, Vitest 4, pnpm. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-skills-and-claude-styling-design.md`

## Global Constraints

- `Button.type` defaults to `'prompt'` wherever it's missing from previously-stored or previously-exported data — no data loss, no rejection of legacy buttons.
- No proprietary Anthropic assets (font files) are bundled or fetched from Anthropic's asset host — only the public fallback font-stack values and public color hex values captured from claude.ai's own CSS are used.
- Every color introduced must have a dark-mode-appropriate value — this project has hit invisible-text-in-dark-mode bugs twice already (once in Stage 1B/1C's UI, once nearly in this same styling pass if new surface backgrounds were added without matching text/border adjustments), so any element that gets an explicit background must also get an explicit, theme-aware foreground/border.
- No `innerHTML` with interpolated user-supplied data anywhere — use `textContent`, consistent with every existing UI file.
- Package manager is pnpm, not npm. `pnpm run build` runs `tsc --noEmit` before `vite build` — new code must be strict-mode clean.
- No new npm dependencies.

---

### Task 1: Button.type + Storage-Layer Migration (TDD)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/storage/chrome-local-adapter.ts`
- Modify: `tests/shared/storage/chrome-local-adapter.test.ts`

**Interfaces:**
- Produces: `ButtonType = 'prompt' | 'skill'` (exported from `types.ts`), `Button` gains a required `type: ButtonType` field. `ChromeLocalStorageAdapter.getButtons()` normalizes any stored record missing `type` (or with an unrecognized value) to `'prompt'`. Every later task in this plan builds on `Button.type` being present on every `Button` object the app ever sees.

- [ ] **Step 1: Update `src/shared/types.ts`**

Replace the full contents:

```ts
export type ButtonType = 'prompt' | 'skill'

export interface Button {
  id: string
  name: string
  order: number
  prompt: string
  type: ButtonType
}
```

- [ ] **Step 2: Write the failing tests**

Replace the full contents of `tests/shared/storage/chrome-local-adapter.test.ts` (this updates every existing `Button`-shaped assertion to include `type: 'prompt'`, since `getButtons()` will always return fully-normalized `Button` objects after this task, and adds three new tests at the end for the migration behavior itself):

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { ChromeLocalStorageAdapter } from '../../../src/shared/storage/chrome-local-adapter'
import type { Button } from '../../../src/shared/types'

function installChromeStorageMock() {
  const store = new Map<string, unknown>()
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            store.set(key, value)
          }
        },
      },
    },
  } as unknown as typeof chrome
  return store
}

describe('ChromeLocalStorageAdapter', () => {
  let store: Map<string, unknown>
  let adapter: ChromeLocalStorageAdapter

  beforeEach(() => {
    store = installChromeStorageMock()
    adapter = new ChromeLocalStorageAdapter()
  })

  it('returns an empty array when nothing is stored', async () => {
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([])
  })

  it('saves a new button and returns it from getButtons', async () => {
    const button: Button = { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.', type: 'prompt' }
    await adapter.saveButton(button)
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([button])
  })

  it('overwrites an existing button with the same id', async () => {
    await adapter.saveButton({ id: '1', name: 'Old', order: 0, prompt: 'Old prompt', type: 'prompt' })
    await adapter.saveButton({ id: '1', name: 'New', order: 0, prompt: 'New prompt', type: 'prompt' })
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'New', order: 0, prompt: 'New prompt', type: 'prompt' }])
  })

  it('deletes a button by id', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A', type: 'prompt' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B', type: 'prompt' })
    await adapter.deleteButton('1')
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '2', name: 'B', order: 1, prompt: 'B', type: 'prompt' }])
  })

  it('reorders buttons and rewrites their order field', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A', type: 'prompt' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B', type: 'prompt' })
    await adapter.reorderButtons(['2', '1'])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([
      { id: '2', name: 'B', order: 0, prompt: 'B', type: 'prompt' },
      { id: '1', name: 'A', order: 1, prompt: 'A', type: 'prompt' },
    ])
  })

  it('preserves a stored button omitted from reorderButtons instead of dropping it', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A', type: 'prompt' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B', type: 'prompt' })
    await adapter.saveButton({ id: '3', name: 'C', order: 2, prompt: 'C', type: 'prompt' })
    // Simulate a stale panel that doesn't know about button '3'.
    await adapter.reorderButtons(['2', '1'])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([
      { id: '2', name: 'B', order: 0, prompt: 'B', type: 'prompt' },
      { id: '1', name: 'A', order: 1, prompt: 'A', type: 'prompt' },
      { id: '3', name: 'C', order: 2, prompt: 'C', type: 'prompt' },
    ])
  })

  it('returns an empty array when stored data is corrupt (not an array)', async () => {
    store.set('buttons', 'not-an-array')
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([])
  })

  it('drops malformed entries from a corrupt array instead of crashing', async () => {
    store.set('buttons', [
      { id: '1', name: 'Valid', order: 0, prompt: 'ok' },
      { id: '2' },
      null,
      'garbage',
    ])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'Valid', order: 0, prompt: 'ok', type: 'prompt' }])
  })

  it('defaults a missing type field to "prompt" when reading legacy stored data', async () => {
    store.set('buttons', [{ id: '1', name: 'Legacy', order: 0, prompt: 'hi' }])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'Legacy', order: 0, prompt: 'hi', type: 'prompt' }])
  })

  it('preserves type: "skill" when reading stored data', async () => {
    store.set('buttons', [{ id: '1', name: 'Doc Summary', order: 0, prompt: '/doc-summary', type: 'skill' }])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([
      { id: '1', name: 'Doc Summary', order: 0, prompt: '/doc-summary', type: 'skill' },
    ])
  })

  it('defaults an unrecognized type value to "prompt" instead of rejecting the button', async () => {
    store.set('buttons', [{ id: '1', name: 'Weird', order: 0, prompt: 'hi', type: 'not-a-real-type' }])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'Weird', order: 0, prompt: 'hi', type: 'prompt' }])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- chrome-local-adapter`
Expected: FAIL — every test in this file fails, since `saveButton`/`getButtons` don't yet accept or normalize a `type` field and the `Button` type doesn't have one to satisfy TypeScript.

- [ ] **Step 4: Update `src/shared/storage/chrome-local-adapter.ts`**

Replace the full contents:

```ts
import type { Button, ButtonType } from '../types'
import type { StorageAdapter } from './storage-adapter'

const STORAGE_KEY = 'buttons'

type RawButton = { id: string; name: string; order: number; prompt: string; type?: unknown }

function isRawButton(value: unknown): value is RawButton {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.order === 'number' &&
    typeof candidate.prompt === 'string'
  )
}

function normalizeType(type: unknown): ButtonType {
  return type === 'skill' ? 'skill' : 'prompt'
}

function normalizeButton(raw: RawButton): Button {
  return {
    id: raw.id,
    name: raw.name,
    order: raw.order,
    prompt: raw.prompt,
    type: normalizeType(raw.type),
  }
}

export class ChromeLocalStorageAdapter implements StorageAdapter {
  async getButtons(): Promise<Button[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    const stored = result[STORAGE_KEY]
    if (!Array.isArray(stored)) return []
    return stored.filter(isRawButton).map(normalizeButton)
  }

  async saveButton(button: Button): Promise<void> {
    const buttons = await this.getButtons()
    const index = buttons.findIndex((b) => b.id === button.id)
    if (index === -1) {
      buttons.push(button)
    } else {
      buttons[index] = button
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: buttons })
  }

  async deleteButton(id: string): Promise<void> {
    const buttons = await this.getButtons()
    const filtered = buttons.filter((b) => b.id !== id)
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered })
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    const buttons = await this.getButtons()
    const byId = new Map(buttons.map((b) => [b.id, b]))
    const seen = new Set<string>()
    const reordered: Button[] = []
    orderedIds.forEach((id) => {
      const button = byId.get(id)
      if (button) {
        seen.add(id)
        reordered.push(button)
      }
    })
    buttons.forEach((button) => {
      if (!seen.has(button.id)) reordered.push(button)
    })
    const withOrder = reordered.map((button, index) => ({ ...button, order: index }))
    await chrome.storage.local.set({ [STORAGE_KEY]: withOrder })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- chrome-local-adapter`
Expected: PASS, all tests green (8 pre-existing + 3 new = 11 in this file).

- [ ] **Step 6: Run the full suite and commit**

Run: `pnpm test`
Expected: PASS, 47 tests total (44 existing + 3 new).

```bash
git add src/shared/types.ts src/shared/storage/chrome-local-adapter.ts tests/shared/storage/chrome-local-adapter.test.ts
git commit -m "feat: add Button.type with storage-layer migration defaulting to prompt"
```

---

### Task 2: ToolService Type Support (TDD)

**Files:**
- Modify: `src/shared/tool-service.ts`
- Modify: `tests/shared/tool-service.test.ts`

**Interfaces:**
- Consumes: `ButtonType`, `Button` from `./types` (Task 1).
- Produces: `ToolService.createButton(name: string, prompt: string, type: ButtonType = 'prompt'): Promise<Button>`, `ToolService.updateButton(id: string, updates: { name?: string; prompt?: string; type?: ButtonType }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add these test cases to `tests/shared/tool-service.test.ts`, inside the existing `describe('ToolService', ...)` block:

```ts
  it('creates a button with type "prompt" by default', async () => {
    const button = await service.createButton('Summarize', 'Summarize this.')
    expect(button.type).toBe('prompt')
  })

  it('creates a button with an explicit type', async () => {
    const button = await service.createButton('Doc Summary', '/doc-summary', 'skill')
    expect(button.type).toBe('skill')
  })

  it('updates a button\'s type', async () => {
    const created = await service.createButton('Name', '/something', 'prompt')
    await service.updateButton(created.id, { type: 'skill' })
    const [button] = await service.listButtons()
    expect(button.type).toBe('skill')
  })

  it('preserves an existing button\'s type when updating unrelated fields', async () => {
    const created = await service.createButton('Name', '/something', 'skill')
    await service.updateButton(created.id, { name: 'Renamed' })
    const [button] = await service.listButtons()
    expect(button.type).toBe('skill')
    expect(button.name).toBe('Renamed')
  })
```

Also update the pre-existing test `'creates a button with an incrementing order and a generated id'` — it currently only checks `order`/`id`/`name`/`prompt`; leave it as-is, it doesn't need a `type` assertion added since it's not testing type behavior specifically (the new tests above cover that).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tool-service`
Expected: FAIL — `createButton`/`updateButton` don't yet accept or return a `type`.

- [ ] **Step 3: Update `src/shared/tool-service.ts`**

Replace the full contents:

```ts
import type { Button, ButtonType } from './types'
import type { StorageAdapter } from './storage/storage-adapter'

export class ToolService {
  constructor(private readonly storage: StorageAdapter) {}

  async listButtons(): Promise<Button[]> {
    const buttons = await this.storage.getButtons()
    return [...buttons].sort((a, b) => a.order - b.order)
  }

  async createButton(name: string, prompt: string, type: ButtonType = 'prompt'): Promise<Button> {
    const existing = await this.storage.getButtons()
    const nextOrder = existing.length === 0 ? 0 : Math.max(...existing.map((b) => b.order)) + 1
    const button: Button = {
      id: crypto.randomUUID(),
      name,
      order: nextOrder,
      prompt,
      type,
    }
    await this.storage.saveButton(button)
    return button
  }

  async updateButton(
    id: string,
    updates: { name?: string; prompt?: string; type?: ButtonType },
  ): Promise<void> {
    const buttons = await this.storage.getButtons()
    const button = buttons.find((b) => b.id === id)
    if (!button) throw new Error(`Button not found: ${id}`)
    await this.storage.saveButton({
      ...button,
      name: updates.name ?? button.name,
      prompt: updates.prompt ?? button.prompt,
      type: updates.type ?? button.type,
    })
  }

  async deleteButton(id: string): Promise<void> {
    await this.storage.deleteButton(id)
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    await this.storage.reorderButtons(orderedIds)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tool-service`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full suite and commit**

Run: `pnpm test`
Expected: PASS, 51 tests total (47 from Task 1 + 4 new).

```bash
git add src/shared/tool-service.ts tests/shared/tool-service.test.ts
git commit -m "feat: add type support to ToolService.createButton/updateButton"
```

---

### Task 3: backup.ts Type Support (TDD)

**Files:**
- Modify: `src/shared/backup.ts`
- Modify: `tests/shared/backup.test.ts`

**Interfaces:**
- Consumes: `ButtonType`, `Button` from `./types` (Task 1).
- Produces: `ImportedTool { name: string; prompt: string; type: ButtonType }`. `serializeButtons` includes `type`; `parseImportedButtons` defaults a missing/unrecognized `type` to `'prompt'`, mirroring Task 1's storage-layer behavior exactly.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `tests/shared/backup.test.ts` (this updates the two existing `parseImportedButtons` tests whose expected output now includes `type: 'prompt'`, and adds four new tests — one for export, three for import — covering `type` end to end):

```ts
import { describe, expect, it } from 'vitest'
import { parseImportedButtons, serializeButtons } from '../../src/shared/backup'
import type { Button } from '../../src/shared/types'

describe('serializeButtons', () => {
  it('serializes buttons to a JSON array of name/prompt pairs, dropping id and order', () => {
    const buttons: Button[] = [
      { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.', type: 'prompt' },
      { id: '2', name: 'Translate', order: 1, prompt: 'Translate this.', type: 'prompt' },
    ]
    const json = serializeButtons(buttons)
    expect(JSON.parse(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
      { name: 'Translate', prompt: 'Translate this.', type: 'prompt' },
    ])
  })

  it('serializes an empty list to an empty array', () => {
    expect(JSON.parse(serializeButtons([]))).toEqual([])
  })

  it('includes each button\'s type in the exported JSON', () => {
    const buttons: Button[] = [
      { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.', type: 'prompt' },
      { id: '2', name: 'Doc Summary', order: 1, prompt: '/doc-summary', type: 'skill' },
    ]
    const json = serializeButtons(buttons)
    expect(JSON.parse(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
      { name: 'Doc Summary', prompt: '/doc-summary', type: 'skill' },
    ])
  })
})

describe('parseImportedButtons', () => {
  it('parses a valid array of name/prompt pairs', () => {
    const json = JSON.stringify([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Translate', prompt: 'Translate this.' },
    ])
    expect(parseImportedButtons(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
      { name: 'Translate', prompt: 'Translate this.', type: 'prompt' },
    ])
  })

  it('ignores extra fields like id or order on each entry', () => {
    const json = JSON.stringify([{ id: 'x', order: 5, name: 'Summarize', prompt: 'Summarize this.' }])
    expect(parseImportedButtons(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
    ])
  })

  it('returns an empty array for an empty JSON array', () => {
    expect(parseImportedButtons('[]')).toEqual([])
  })

  it('throws a descriptive error for invalid JSON', () => {
    expect(() => parseImportedButtons('not json')).toThrow("That file isn't valid JSON.")
  })

  it('throws a descriptive error when the top level is not an array', () => {
    expect(() => parseImportedButtons('{"name":"x","prompt":"y"}')).toThrow(
      'Expected a JSON array of tools.',
    )
  })

  it('throws a descriptive error when an entry is not an object', () => {
    expect(() => parseImportedButtons('["not an object"]')).toThrow("Tool 1 isn't a valid object.")
  })

  it('throws a descriptive error when an entry is missing a name', () => {
    expect(() => parseImportedButtons(JSON.stringify([{ prompt: 'Summarize this.' }]))).toThrow(
      'Tool 1 is missing a name.',
    )
  })

  it('throws a descriptive error when an entry is missing a prompt', () => {
    expect(() => parseImportedButtons(JSON.stringify([{ name: 'Summarize' }]))).toThrow(
      'Tool 1 is missing a prompt.',
    )
  })

  it('reports the correct 1-based index for the second entry', () => {
    const json = JSON.stringify([{ name: 'Summarize', prompt: 'Summarize this.' }, { name: 'Bad' }])
    expect(() => parseImportedButtons(json)).toThrow('Tool 2 is missing a prompt.')
  })

  it('preserves type: "skill" on import', () => {
    const json = JSON.stringify([{ name: 'Doc Summary', prompt: '/doc-summary', type: 'skill' }])
    expect(parseImportedButtons(json)).toEqual([{ name: 'Doc Summary', prompt: '/doc-summary', type: 'skill' }])
  })

  it('defaults a missing type to "prompt" on import', () => {
    const json = JSON.stringify([{ name: 'Summarize', prompt: 'Summarize this.' }])
    expect(parseImportedButtons(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.', type: 'prompt' },
    ])
  })

  it('defaults an unrecognized type value to "prompt" on import', () => {
    const json = JSON.stringify([{ name: 'Weird', prompt: 'hi', type: 'bogus' }])
    expect(parseImportedButtons(json)).toEqual([{ name: 'Weird', prompt: 'hi', type: 'prompt' }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- backup`
Expected: FAIL — `type` is not yet part of `ImportedTool`/the parse output.

- [ ] **Step 3: Update `src/shared/backup.ts`**

Replace the full contents:

```ts
import type { Button, ButtonType } from './types'

export interface ImportedTool {
  name: string
  prompt: string
  type: ButtonType
}

function normalizeType(type: unknown): ButtonType {
  return type === 'skill' ? 'skill' : 'prompt'
}

export function serializeButtons(buttons: Button[]): string {
  const exportable: ImportedTool[] = buttons.map((button) => ({
    name: button.name,
    prompt: button.prompt,
    type: button.type,
  }))
  return JSON.stringify(exportable, null, 2)
}

export function parseImportedButtons(json: string): ImportedTool[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of tools.')
  }

  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Tool ${index + 1} isn't a valid object.`)
    }
    const { name, prompt, type } = item as Record<string, unknown>
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`Tool ${index + 1} is missing a name.`)
    }
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error(`Tool ${index + 1} is missing a prompt.`)
    }
    return { name, prompt, type: normalizeType(type) }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- backup`
Expected: PASS, all tests green (11 pre-existing + 4 new = 15 in this file).

- [ ] **Step 5: Run the full suite and commit**

Run: `pnpm test`
Expected: PASS, 55 tests total (51 from Task 2 + 4 new).

```bash
git add src/shared/backup.ts tests/shared/backup.test.ts
git commit -m "feat: add type support to backup.ts export/import"
```

---

### Task 4: UI Wiring — Toggle, Badge, and Claude-Matched Styling

This is the largest task, bundling everything that touches the shared `RenderContext`/`renderApp` surface and the full `style.css` rewrite together — the same reasoning as every prior UI-heavy task in this project: splitting these would leave one half referencing CSS classes or context fields the other half hasn't landed yet.

**Files:**
- Modify: `src/sidepanel/EditForm.ts` (full replace — adds the Prompt/Skill toggle)
- Modify: `src/sidepanel/ButtonRow.ts` (full replace — adds the `/` badge)
- Modify: `src/sidepanel/render.ts` (type-only change to `RenderContext.onSave`'s signature)
- Modify: `src/sidepanel/main.ts` (full replace — threads `type` through `onSave`/`onImport`)
- Modify: `src/sidepanel/style.css` (full replace — color tokens, font stack, type scale, new toggle/badge rules)

**Interfaces:**
- Consumes: `ButtonType` from `../shared/types` (Task 1); `ToolService.createButton`/`updateButton`'s `type` parameter (Task 2); `ImportedTool.type` from `../shared/backup` (Task 3).
- Produces: `EditFormContext.onSave`'s data parameter gains `type: ButtonType`. No other public interface changes — `ButtonRowContext`, `RenderContext`'s other fields, and `renderApp`'s signature are unchanged from Stage 1E.

- [ ] **Step 1: Replace `src/sidepanel/EditForm.ts`**

```ts
import type { Button, ButtonType } from '../shared/types'

export interface EditFormContext {
  onSave: (data: { id: string | null; name: string; prompt: string; type: ButtonType }) => void
  onCancel: () => void
}

export function renderEditForm(button: Button | null, context: EditFormContext): HTMLElement {
  const form = document.createElement('form')
  form.className = 'edit-form'

  const initialType: ButtonType = button?.type ?? 'prompt'

  const typeToggle = document.createElement('div')
  typeToggle.className = 'type-toggle'

  const promptOption = document.createElement('label')
  promptOption.className = 'type-toggle-option'
  const promptRadio = document.createElement('input')
  promptRadio.type = 'radio'
  promptRadio.name = 'button-type'
  promptRadio.value = 'prompt'
  promptRadio.checked = initialType === 'prompt'
  promptOption.appendChild(promptRadio)
  promptOption.appendChild(document.createTextNode('Prompt'))
  typeToggle.appendChild(promptOption)

  const skillOption = document.createElement('label')
  skillOption.className = 'type-toggle-option'
  const skillRadio = document.createElement('input')
  skillRadio.type = 'radio'
  skillRadio.name = 'button-type'
  skillRadio.value = 'skill'
  skillRadio.checked = initialType === 'skill'
  skillOption.appendChild(skillRadio)
  skillOption.appendChild(document.createTextNode('Skill'))
  typeToggle.appendChild(skillOption)

  form.appendChild(typeToggle)

  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Name'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.required = true
  nameInput.value = button?.name ?? ''
  nameLabel.appendChild(nameInput)
  form.appendChild(nameLabel)

  const promptLabel = document.createElement('label')
  const promptLabelText = document.createElement('span')
  promptLabelText.textContent = initialType === 'skill' ? 'Skill invocation' : 'Prompt'
  promptLabel.appendChild(promptLabelText)
  const promptInput = document.createElement('textarea')
  promptInput.required = true
  promptInput.rows = 8
  promptInput.value = button?.prompt ?? ''
  promptInput.placeholder = initialType === 'skill' ? '/skill-name argument' : ''
  promptLabel.appendChild(promptInput)
  form.appendChild(promptLabel)

  function updatePromptFieldLabel(type: ButtonType): void {
    promptLabelText.textContent = type === 'skill' ? 'Skill invocation' : 'Prompt'
    promptInput.placeholder = type === 'skill' ? '/skill-name argument' : ''
  }

  promptRadio.addEventListener('change', () => updatePromptFieldLabel('prompt'))
  skillRadio.addEventListener('change', () => updatePromptFieldLabel('skill'))

  const actions = document.createElement('div')
  actions.className = 'edit-form-actions'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.textContent = 'Cancel'
  cancelButton.addEventListener('click', context.onCancel)
  actions.appendChild(cancelButton)

  const saveButton = document.createElement('button')
  saveButton.type = 'submit'
  saveButton.textContent = 'Save'
  actions.appendChild(saveButton)

  form.appendChild(actions)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    context.onSave({
      id: button?.id ?? null,
      name: nameInput.value.trim(),
      prompt: promptInput.value.trim(),
      type: skillRadio.checked ? 'skill' : 'prompt',
    })
  })

  return form
}
```

- [ ] **Step 2: Replace `src/sidepanel/ButtonRow.ts`**

Add a skill badge, inserted between the drag handle and the name button. Replace the full contents:

```ts
import type { Button } from '../shared/types'

export interface ButtonRowContext {
  isRunning: boolean
  runError: string | null
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
  onDrop: (draggedId: string, position: 'before' | 'after') => void
  onArrowMove: (direction: 'up' | 'down') => void
}

function dropPosition(event: DragEvent, item: HTMLElement): 'before' | 'after' {
  const rect = item.getBoundingClientRect()
  return event.clientY - rect.top > rect.height / 2 ? 'after' : 'before'
}

export function renderButtonRow(button: Button, context: ButtonRowContext): HTMLElement {
  const item = document.createElement('li')
  item.className = 'button-row-wrapper'

  const row = document.createElement('div')
  row.className = 'button-row'

  const dragHandle = document.createElement('button')
  dragHandle.type = 'button'
  dragHandle.className = 'drag-handle'
  dragHandle.textContent = '⠿'
  dragHandle.dataset.buttonId = button.id
  dragHandle.setAttribute('aria-label', `Reorder ${button.name}. Press arrow keys to move, or drag.`)
  dragHandle.draggable = true
  dragHandle.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/plain', button.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    item.classList.add('dragging')
  })
  dragHandle.addEventListener('dragend', () => {
    item.classList.remove('dragging')
  })
  dragHandle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      context.onArrowMove('up')
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      context.onArrowMove('down')
    }
  })
  row.appendChild(dragHandle)

  if (button.type === 'skill') {
    const badge = document.createElement('span')
    badge.className = 'skill-badge'
    badge.textContent = '/'
    badge.setAttribute('aria-hidden', 'true')
    row.appendChild(badge)
  }

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

  item.addEventListener('dragover', (event) => {
    event.preventDefault()
    const isAfter = dropPosition(event, item) === 'after'
    item.classList.toggle('drag-over-top', !isAfter)
    item.classList.toggle('drag-over-bottom', isAfter)
  })
  item.addEventListener('dragleave', () => {
    item.classList.remove('drag-over-top', 'drag-over-bottom')
  })
  item.addEventListener('drop', (event) => {
    event.preventDefault()
    item.classList.remove('drag-over-top', 'drag-over-bottom')
    const draggedId = event.dataTransfer?.getData('text/plain')
    if (!draggedId || draggedId === button.id) return
    context.onDrop(draggedId, dropPosition(event, item))
  })

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

- [ ] **Step 3: Update `src/sidepanel/render.ts`**

This is a type-only change — two edits. First, find the top-level import:

```ts
import type { Button } from '../shared/types'
```

Replace with:

```ts
import type { Button, ButtonType } from '../shared/types'
```

Second, find the `RenderContext` interface's `onSave` line:

```ts
  onSave: (data: { id: string | null; name: string; prompt: string }) => void
```

Replace with:

```ts
  onSave: (data: { id: string | null; name: string; prompt: string; type: ButtonType }) => void
```

- [ ] **Step 4: Update `src/sidepanel/main.ts`**

Two small changes. First, find `onSave`'s body:

```ts
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
```

Replace with:

```ts
      onSave: async (data) => {
        if (!data.name || !data.prompt) return
        clearRunErrors()
        try {
          if (data.id) {
            await toolService.updateButton(data.id, { name: data.name, prompt: data.prompt, type: data.type })
          } else {
            await toolService.createButton(data.name, data.prompt, data.type)
          }
          view = { mode: 'list' }
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to save button', error)
          root.textContent = 'Something went wrong saving that tool. Check the console for details.'
        }
      },
```

Second, find `onImport`'s body:

```ts
      onImport: async (file: File) => {
        try {
          const text = await file.text()
          const parsed = parseImportedButtons(text)
          for (const { name, prompt } of parsed) {
            await toolService.createButton(name, prompt)
          }
```

Replace the `for` loop line with:

```ts
      onImport: async (file: File) => {
        try {
          const text = await file.text()
          const parsed = parseImportedButtons(text)
          for (const { name, prompt, type } of parsed) {
            await toolService.createButton(name, prompt, type)
          }
```

(Only the `for` loop's destructuring and the `createButton` call change — everything else in `onImport` stays the same.)

- [ ] **Step 5: Replace `src/sidepanel/style.css`**

Replace the full contents:

```css
:root {
  --surface-canvas: #f9f9f7;
  --surface-card: #fcfcfb;
  --surface-input: #fff;
  --surface-hover: #f2f2f2;
  --text-primary: #0b0b0b;
  --text-muted: #898781;
  --accent: #d97757;
  --accent-hover: #c96a4a;
  --accent-text-on: #fff;
  --border: #e1e0d9;
  --danger: #b3261e;
  --danger-hover-bg: #fbeceb;
  --danger-border: #eac6c2;
  --success: #2e7d32;

  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
}

@media (prefers-color-scheme: dark) {
  :root {
    --surface-canvas: #0b0b0b;
    --surface-card: #151515;
    --surface-input: #20201f;
    --surface-hover: #262625;
    --text-primary: #f0efec;
    --text-muted: #898781;
    --accent: #d97757;
    --accent-hover: #e08a68;
    --accent-text-on: #fff;
    --border: #33322f;
    --danger: #ff6b60;
    --danger-hover-bg: #3a1f1d;
    --danger-border: #5c2e29;
    --success: #6fbf73;
  }
}

body {
  margin: 0;
  padding: 12px;
  background: var(--surface-canvas);
  color: var(--text-primary);
}

.empty-state {
  color: var(--text-muted);
  font-size: 14px;
}

.button-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.button-row-wrapper {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.button-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-card);
  border: 1px solid var(--border);
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
  color: var(--text-muted);
}

.button-row-status-error {
  color: var(--danger);
}

.skill-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 10px;
}

.add-button {
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-text-on);
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}

.button-row-controls {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.icon-button {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-input);
  color: var(--text-primary);
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.icon-button-danger {
  color: var(--danger);
  border-color: var(--danger-border);
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.edit-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.edit-form input,
.edit-form textarea {
  font: inherit;
  padding: 6px 8px;
  background: var(--surface-input);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  resize: vertical;
}

.edit-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.edit-form-actions button {
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}

.edit-form-actions button[type='submit'] {
  border: none;
  background: var(--accent);
  color: var(--accent-text-on);
}

.edit-form-actions button[type='button'] {
  border: 1px solid var(--border);
  background: var(--surface-input);
  color: var(--text-primary);
}

.type-toggle {
  display: flex;
  gap: 6px;
}

.type-toggle-option {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
}

.type-toggle-option:has(input:checked) {
  border-color: var(--accent);
  color: var(--accent);
}

.type-toggle-option input {
  margin: 0;
}

.drag-handle {
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--text-muted);
  padding: 4px 6px;
  font-size: 14px;
  cursor: grab;
  flex-shrink: 0;
}

.drag-handle:active {
  cursor: grabbing;
}

.button-row-wrapper.dragging {
  opacity: 0.5;
}

.button-row-wrapper.drag-over-top {
  box-shadow: 0 -2px 0 0 var(--accent);
}

.button-row-wrapper.drag-over-bottom {
  box-shadow: 0 2px 0 0 var(--accent);
}

.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-action-button {
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-input);
  color: var(--text-primary);
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}

.settings-file-input {
  display: none;
}

.settings-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.settings-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.settings-success {
  margin: 0;
  font-size: 12px;
  color: var(--success);
}

.settings-back-button {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--text-muted);
  padding: 4px 0;
  font-size: 13px;
  cursor: pointer;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.icon-button:hover:not(:disabled) {
  background: var(--surface-hover);
}

.icon-button-danger:hover:not(:disabled) {
  background: var(--danger-hover-bg);
}

.add-button:hover {
  background: var(--accent-hover);
}

.button-row-name:hover:not(:disabled) {
  color: var(--accent);
}

.drag-handle:hover {
  background: var(--surface-hover);
}

.settings-action-button:hover,
.settings-button:hover {
  background: var(--surface-hover);
}

.settings-back-button:hover {
  color: var(--text-primary);
}

.edit-form-actions button[type='button']:hover {
  background: var(--surface-hover);
}

.edit-form-actions button[type='submit']:hover {
  background: var(--accent-hover);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 6: Build and verify**

Run: `pnpm run build`
Expected: exits 0, no TypeScript errors — confirms `EditForm.ts`, `ButtonRow.ts`, `render.ts`, and `main.ts`'s `type`-threading all line up correctly.

Run: `pnpm test`
Expected: PASS, still 55 tests (no test changes in this task — DOM/UI/CSS stays manual-verification-only, matching this project's established convention).

- [ ] **Step 7: Manual verification**

If you have a real Chrome browser:

1. `pnpm run build`, reload the extension, open the side panel.
2. Click "+ Add tool" — confirm a Prompt/Skill toggle appears, defaulting to Prompt.
3. Switch to Skill — confirm the field label changes to "Skill invocation" and the placeholder becomes `/skill-name argument`.
4. Create a skill button (e.g. name "Doc Summary", invocation `/doc-summary`) — confirm it appears in the list with a small `/` badge before its name, and a plain prompt button does not have the badge.
5. Edit the skill button — confirm the toggle correctly shows "Skill" selected and the field is labeled "Skill invocation".
6. Export your tools, inspect the downloaded `.json` — confirm each entry has a `"type"` field. Import that file back in — confirm the re-imported skill button still shows the `/` badge.
7. Toggle your OS/browser between light and dark mode (or use Chrome DevTools' rendering emulation for `prefers-color-scheme`) — confirm every piece of text remains clearly readable against its background in both themes, especially: button row cards, the Prompt/Skill toggle, the Delete button, and settings error/success text.
8. Compare the panel's general look side-by-side with claude.ai's own interface — confirm it reads as visually related (warm off-white/near-black surfaces, the same clay-orange accent, similar type sizing) without looking identical or like an attempted forgery of Claude's UI.

If no real Chrome browser is available in this environment, say so explicitly rather than fabricating this check — this is expected and matches every prior UI task in this project.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/EditForm.ts src/sidepanel/ButtonRow.ts src/sidepanel/render.ts src/sidepanel/main.ts src/sidepanel/style.css
git commit -m "feat: add skill button toggle/badge and restyle to match claude.ai's fonts and colors"
```

---

### Task 5: Full Acceptance Pass

**Files:** none (verification only)

**Interfaces:** none — this task exercises everything built in Tasks 1-4 together.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm test`
Expected: PASS, all 55 tests green.

- [ ] **Step 2: Run the build**

Run: `pnpm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Walk the acceptance checklist manually**

Verify each of the following (requires a real Chrome browser):

- [ ] Creating a plain prompt button still works exactly as before (no toggle confusion, no badge).
- [ ] Creating a skill button works, shows the `/` badge, and clicking it types the slash-invocation into Claude's chat box (same insert-only behavior as a prompt — it does not auto-send).
- [ ] Editing a button correctly preserves and displays its existing type.
- [ ] Export/import round-trips both prompt and skill buttons correctly, including type.
- [ ] A `.json` file exported before this change (no `type` field on its entries) imports successfully with every entry defaulting to a plain prompt button.
- [ ] Every existing Stage 1B/1C/1D/1E feature (CRUD, drag-and-drop reorder, keyboard reorder, settings panel, hover/focus states) still works unchanged.
- [ ] Text is legible in both light and dark mode everywhere in the panel, including the new toggle and badge.

- [ ] **Step 4: Record any failures**

If any checklist item fails, do not mark this task complete — identify which task's code is responsible and fix there before considering this feature done.

- [ ] **Step 5: No commit for this task**

Verification-only, no file changes expected. If everything passes, this feature is complete as of Task 4's commit.
