# Stage 1E: UX / Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the up/down reorder buttons with drag-and-drop (plus a keyboard-arrow equivalent), add a settings panel for JSON export/import of the button list, and pass over the whole side panel for hover states, focus-visible outlines, and visual-hierarchy consistency.

**Architecture:** `src/shared/backup.ts` holds pure, unit-tested export/import logic with no DOM dependency, reusing `ToolService.createButton` for fresh-id/continuing-order generation on import rather than duplicating that logic. `ButtonRow.ts` gains a keyboard-focusable drag handle that owns all raw drag/keyboard event handling internally, surfacing only the semantic result (`onDrop(draggedId, position)` / `onArrowMove(direction)`) to `render.ts`, which has the full button list needed to compute the new order and funnels both paths through the same `toolService.reorderButtons` call the old `onMoveUp`/`onMoveDown` handlers used. A new `SettingsPanel.ts` adds a third `view` mode alongside the existing `list`/`form` modes. The settings panel and the reorder overhaul both modify the same `RenderContext`/`renderApp` surface in `render.ts` and `main.ts`, so they are one task (Task 2) rather than two — splitting them would force one to stub placeholder fields for the other, the same interface-split problem this project's two earlier UI-heavy stages each hit and fixed by merging.

**Tech Stack:** Same as prior stages — TypeScript 5, Vite 8, `@crxjs/vite-plugin`, Vitest 4, pnpm. No new dependencies — export/import uses the native `Blob`/`URL.createObjectURL`/File API, drag-and-drop uses native HTML5 drag events.

**Spec:** `docs/superpowers/specs/2026-08-16-stage1e-ux-polish-design.md`

**Note on backup.ts's exact shape (refines the spec's approximation):** the spec sketched `parseImportedButtons(json, existing): Button[]` computing fresh ids/order itself. `ToolService.createButton(name, prompt)` (already shipped) already generates a fresh id and computes `order` as one past the current max every time it's called — calling it once per imported entry, in file order, produces exactly the "fresh ids, continuing order, additive" behavior the spec requires, with no duplicated logic. So `backup.ts` only needs to validate the file and extract `{ name, prompt }` pairs; the UI layer loops calling `toolService.createButton` for each. The export/import file format is deliberately just `{ name, prompt }[]` — no `id`/`order` fields, since those are meaningless across machines and get regenerated on import regardless.

**Note on spacing scale and responsiveness (both spec decisions, neither gets a dedicated task):** the spec calls for "a consistent spacing scale" and CSS that "holds up" as the side panel resizes. The existing CSS from Stages 1B/1C already uses a small, consistent set of spacing values (4/6/8/10/12/16px) and a flex-based layout (`.button-row-name { flex: 1; min-width: 0 }` with ellipsis, `.button-row-controls { flex-shrink: 0 }`) that already scales across Chrome's side-panel resize range without new rules — Chrome itself also enforces a browser-level minimum side-panel width, further bounding how narrow this ever gets. Introducing CSS custom-property spacing tokens or new breakpoints for values that are already visually consistent would be the kind of unnecessary visual complexity the product spec explicitly warns against. Both are verified in Task 4's acceptance checklist rather than separately implemented.

## Global Constraints

- Drag-and-drop is desktop-only (native HTML5 drag events have no touch story) — no touch fallback is built.
- Every interactive element gets an explicit `:focus-visible` outline — do not rely on browser default focus styling, which is invisible/faint in this project's dark theme (the same class of bug as the earlier dark-mode text-contrast fix).
- The row status line (`Running…`/error) must have `role="status"` and `aria-live="polite"` so screen readers announce it without requiring focus to move there.
- Import is additive only — it must never delete or overwrite existing buttons, and must not write anything to storage until the entire file has been validated.
- No `innerHTML` with interpolated user-supplied data anywhere (button names, prompts, error messages) — use `textContent`, consistent with every existing UI file.
- Package manager is pnpm, not npm. `pnpm run build` runs `tsc --noEmit` before `vite build` — new code must be strict-mode clean.
- No new npm dependencies.

---

### Task 1: backup.ts — Export/Import Pure Logic (TDD)

**Files:**
- Create: `src/shared/backup.ts`
- Test: `tests/shared/backup.test.ts`

**Interfaces:**
- Consumes: `Button` from `./types`.
- Produces: `ImportedTool { name: string; prompt: string }`, `serializeButtons(buttons: Button[]): string`, `parseImportedButtons(json: string): ImportedTool[]` (throws a descriptive `Error` on any invalid input). Task 2's settings wiring calls both.

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/backup.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseImportedButtons, serializeButtons } from '../../src/shared/backup'
import type { Button } from '../../src/shared/types'

describe('serializeButtons', () => {
  it('serializes buttons to a JSON array of name/prompt pairs, dropping id and order', () => {
    const buttons: Button[] = [
      { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.' },
      { id: '2', name: 'Translate', order: 1, prompt: 'Translate this.' },
    ]
    const json = serializeButtons(buttons)
    expect(JSON.parse(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Translate', prompt: 'Translate this.' },
    ])
  })

  it('serializes an empty list to an empty array', () => {
    expect(JSON.parse(serializeButtons([]))).toEqual([])
  })
})

describe('parseImportedButtons', () => {
  it('parses a valid array of name/prompt pairs', () => {
    const json = JSON.stringify([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Translate', prompt: 'Translate this.' },
    ])
    expect(parseImportedButtons(json)).toEqual([
      { name: 'Summarize', prompt: 'Summarize this.' },
      { name: 'Translate', prompt: 'Translate this.' },
    ])
  })

  it('ignores extra fields like id or order on each entry', () => {
    const json = JSON.stringify([{ id: 'x', order: 5, name: 'Summarize', prompt: 'Summarize this.' }])
    expect(parseImportedButtons(json)).toEqual([{ name: 'Summarize', prompt: 'Summarize this.' }])
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- backup`
Expected: FAIL — `Cannot find module '../../src/shared/backup'`

- [ ] **Step 3: Implement `src/shared/backup.ts`**

```ts
import type { Button } from './types'

export interface ImportedTool {
  name: string
  prompt: string
}

export function serializeButtons(buttons: Button[]): string {
  const exportable: ImportedTool[] = buttons.map((button) => ({
    name: button.name,
    prompt: button.prompt,
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
    const { name, prompt } = item as Record<string, unknown>
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`Tool ${index + 1} is missing a name.`)
    }
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error(`Tool ${index + 1} is missing a prompt.`)
    }
    return { name, prompt }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- backup`
Expected: PASS, all 11 tests green.

- [ ] **Step 5: Run the full suite and commit**

Run: `pnpm test`
Expected: PASS, 33 tests total (22 existing + 11 new).

```bash
git add src/shared/backup.ts tests/shared/backup.test.ts
git commit -m "feat: add pure export/import logic for the button list"
```

---

### Task 2: Settings Panel + Drag-and-Drop/Keyboard Reorder

This task is intentionally large — `SettingsPanel.ts`, `ButtonRow.ts`, `render.ts`, and `main.ts` are producer/consumer of the same `RenderContext`/`renderApp` surface, and splitting them would leave one half stubbing placeholder fields for the other, the same problem this project already hit and fixed twice (Stage 1B/1C's Task 7, Stage 1D's Task 5). They're one task here for the same reason.

**Files:**
- Create: `src/sidepanel/SettingsPanel.ts`
- Modify: `src/sidepanel/ButtonRow.ts` (full replace — drag handle replaces the up/down icon buttons)
- Modify: `src/sidepanel/render.ts` (full replace — adds `'settings'` view mode, `onDrop`/`onArrowMove`/settings context)
- Modify: `src/sidepanel/main.ts` (full replace — settings state/handlers, real `onDrop`/`onArrowMove` handlers)
- Modify: `src/sidepanel/style.css` (append settings panel, drag-handle, and drop-indicator styles; fix `.toolbar` and `.button-row` layout for the new elements)

**Interfaces:**
- Consumes: `serializeButtons`, `parseImportedButtons`, `ImportedTool` from `../shared/backup` (Task 1); `ToolService.createButton`/`reorderButtons` (existing).
- Produces: `SettingsPanelContext { onExport: () => void; onImport: (file: File) => void; onBack: () => void; importError: string | null; importSuccessCount: number | null }` and `renderSettingsPanel(context): HTMLElement`. `View` gains `{ mode: 'settings' }`. `ButtonRowContext { isRunning, runError, onRun, onEdit, onDelete, onDrop: (draggedId: string, position: 'before' | 'after') => void, onArrowMove: (direction: 'up' | 'down') => void }` — `isFirst`/`isLast` are removed; boundary checks now live in `render.ts`'s reorder-computation helpers. `RenderContext` gains `onDrop: (draggedId: string, targetId: string, position: 'before' | 'after') => void`, `onArrowMove: (id: string, direction: 'up' | 'down') => void`, `onOpenSettings: () => void`, `onExport: () => void`, `onImport: (file: File) => void`, `onSettingsBack: () => void`, and loses `onMoveUp`/`onMoveDown`. `renderApp`'s signature gains a `settingsState: { error: string | null; successCount: number | null }` parameter, inserted after `runState` and before `context`.

- [ ] **Step 1: Create `src/sidepanel/SettingsPanel.ts`**

```ts
export interface SettingsPanelContext {
  onExport: () => void
  onImport: (file: File) => void
  onBack: () => void
  importError: string | null
  importSuccessCount: number | null
}

export function renderSettingsPanel(context: SettingsPanelContext): HTMLElement {
  const container = document.createElement('div')
  container.className = 'settings-panel'

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Settings'
  container.appendChild(heading)

  const exportSection = document.createElement('div')
  exportSection.className = 'settings-section'
  const exportButton = document.createElement('button')
  exportButton.type = 'button'
  exportButton.className = 'settings-action-button'
  exportButton.textContent = 'Export tools'
  exportButton.addEventListener('click', context.onExport)
  exportSection.appendChild(exportButton)
  const exportHint = document.createElement('p')
  exportHint.className = 'settings-hint'
  exportHint.textContent = 'Downloads all your tools as a .json file.'
  exportSection.appendChild(exportHint)
  container.appendChild(exportSection)

  const importSection = document.createElement('div')
  importSection.className = 'settings-section'
  const importButton = document.createElement('button')
  importButton.type = 'button'
  importButton.className = 'settings-action-button'
  importButton.textContent = 'Import tools'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'application/json'
  fileInput.className = 'settings-file-input'
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) context.onImport(file)
    fileInput.value = ''
  })
  importButton.addEventListener('click', () => fileInput.click())
  importSection.appendChild(importButton)
  importSection.appendChild(fileInput)
  const importHint = document.createElement('p')
  importHint.className = 'settings-hint'
  importHint.textContent = 'Adds tools from a .json file to your existing list.'
  importSection.appendChild(importHint)

  if (context.importError) {
    const error = document.createElement('p')
    error.className = 'settings-error'
    error.setAttribute('role', 'status')
    error.setAttribute('aria-live', 'polite')
    error.textContent = context.importError
    importSection.appendChild(error)
  } else if (context.importSuccessCount !== null) {
    const success = document.createElement('p')
    success.className = 'settings-success'
    success.setAttribute('role', 'status')
    success.setAttribute('aria-live', 'polite')
    success.textContent = `Imported ${context.importSuccessCount} tool${context.importSuccessCount === 1 ? '' : 's'}.`
    importSection.appendChild(success)
  }
  container.appendChild(importSection)

  const backButton = document.createElement('button')
  backButton.type = 'button'
  backButton.className = 'settings-back-button'
  backButton.textContent = '← Back'
  backButton.addEventListener('click', context.onBack)
  container.appendChild(backButton)

  return container
}
```

- [ ] **Step 2: Replace `src/sidepanel/ButtonRow.ts`**

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
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.textContent = 'Running…'
    item.appendChild(status)
  } else if (context.runError) {
    const status = document.createElement('p')
    status.className = 'button-row-status button-row-status-error'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.textContent = context.runError
    item.appendChild(status)
  }

  return item
}
```

- [ ] **Step 3: Replace `src/sidepanel/render.ts`**

```ts
import type { Button } from '../shared/types'
import { renderButtonRow } from './ButtonRow'
import { renderEditForm } from './EditForm'
import { renderSettingsPanel } from './SettingsPanel'

export type View = { mode: 'list' } | { mode: 'form'; button: Button | null } | { mode: 'settings' }

export interface RunState {
  isRunning: boolean
  error: string | null
}

export interface SettingsState {
  error: string | null
  successCount: number | null
}

export interface RenderContext {
  onRun: (button: Button) => void
  onEdit: (button: Button) => void
  onDelete: (button: Button) => void
  onDrop: (draggedId: string, targetId: string, position: 'before' | 'after') => void
  onArrowMove: (id: string, direction: 'up' | 'down') => void
  onAddClick: () => void
  onSave: (data: { id: string | null; name: string; prompt: string }) => void
  onCancel: () => void
  onOpenSettings: () => void
  onExport: () => void
  onImport: (file: File) => void
  onSettingsBack: () => void
}

export function withMovedId(
  ids: string[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'after',
): string[] {
  const remaining = ids.filter((id) => id !== draggedId)
  const targetIndex = remaining.indexOf(targetId)
  const insertAt = position === 'before' ? targetIndex : targetIndex + 1
  remaining.splice(insertAt, 0, draggedId)
  return remaining
}

export function withSwappedAdjacent(ids: string[], id: string, direction: 'up' | 'down'): string[] {
  const index = ids.indexOf(id)
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || swapWith < 0 || swapWith >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
  return next
}

export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  context: RenderContext,
): void {
  root.innerHTML = ''

  if (view.mode === 'form') {
    root.appendChild(renderEditForm(view.button, { onSave: context.onSave, onCancel: context.onCancel }))
    return
  }

  if (view.mode === 'settings') {
    root.appendChild(
      renderSettingsPanel({
        onExport: context.onExport,
        onImport: context.onImport,
        onBack: context.onSettingsBack,
        importError: settingsState.error,
        importSuccessCount: settingsState.successCount,
      }),
    )
    return
  }

  const header = document.createElement('div')
  header.className = 'toolbar'
  const settingsButton = document.createElement('button')
  settingsButton.type = 'button'
  settingsButton.className = 'icon-button settings-button'
  settingsButton.textContent = '⚙'
  settingsButton.setAttribute('aria-label', 'Settings')
  settingsButton.addEventListener('click', context.onOpenSettings)
  header.appendChild(settingsButton)
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
  buttons.forEach((button) => {
    const state = runState.get(button.id) ?? { isRunning: false, error: null }
    list.appendChild(
      renderButtonRow(button, {
        isRunning: state.isRunning,
        runError: state.error,
        onRun: () => context.onRun(button),
        onEdit: () => context.onEdit(button),
        onDelete: () => context.onDelete(button),
        onDrop: (draggedId, position) => context.onDrop(draggedId, button.id, position),
        onArrowMove: (direction) => context.onArrowMove(button.id, direction),
      }),
    )
  })
  root.appendChild(list)
}
```

- [ ] **Step 4: Replace `src/sidepanel/main.ts`**

```ts
import { ToolService } from '../shared/tool-service'
import { ChromeLocalStorageAdapter } from '../shared/storage/chrome-local-adapter'
import {
  renderApp,
  withMovedId,
  withSwappedAdjacent,
  type View,
  type RunState,
  type SettingsState,
} from './render'
import type { Button } from '../shared/types'
import type { InsertPromptRequest, InsertPromptResponse } from '../shared/messages'
import { parseImportedButtons, serializeButtons } from '../shared/backup'

const toolService = new ToolService(new ChromeLocalStorageAdapter())
const root = document.getElementById('app')

if (!root) {
  throw new Error('[Claude Tools] sidepanel root element (#app) is missing')
}

let view: View = { mode: 'list' }
const runState = new Map<string, RunState>()
const settingsState: SettingsState = { error: null, successCount: null }

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
    renderApp(root, buttons, view, runState, settingsState, {
      onRun: async (button: Button) => {
        const alreadyRunning = [...runState.values()].some((state) => state.isRunning)
        if (alreadyRunning) return
        clearRunErrors()
        runState.set(button.id, { isRunning: true, error: null })
        if (view.mode === 'list') await refresh(root)

        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab?.id || !tab.url) {
            console.warn('[Claude Tools] no active claude.ai tab to run against')
            runState.set(button.id, { isRunning: false, error: 'Open claude.ai to use this tool.' })
            if (view.mode === 'list') await refresh(root)
            return
          }

          const request: InsertPromptRequest = { type: 'INSERT_PROMPT', prompt: button.prompt }
          let response: InsertPromptResponse
          try {
            response = await chrome.tabs.sendMessage<InsertPromptRequest, InsertPromptResponse>(
              tab.id,
              request,
            )
          } catch (error) {
            console.error('[Claude Tools] failed to reach content script', error)
            runState.set(button.id, { isRunning: false, error: 'Reload the Claude tab and try again.' })
            if (view.mode === 'list') await refresh(root)
            return
          }

          if (response.ok) {
            runState.set(button.id, { isRunning: false, error: null })
          } else {
            console.error('[Claude Tools] run failed', response.error, response.message)
            runState.set(button.id, { isRunning: false, error: response.message })
          }
          if (view.mode === 'list') await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] unexpected error running button', error)
          runState.set(button.id, {
            isRunning: false,
            error: 'Something went wrong running that tool. Check the console for details.',
          })
          if (view.mode === 'list') await refresh(root)
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
      onDrop: async (draggedId: string, targetId: string, position: 'before' | 'after') => {
        clearRunErrors()
        const ids = withMovedId(
          buttons.map((b) => b.id),
          draggedId,
          targetId,
          position,
        )
        try {
          await toolService.reorderButtons(ids)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder buttons', error)
          root.textContent = 'Something went wrong reordering your tools. Check the console for details.'
        }
      },
      onArrowMove: async (id: string, direction: 'up' | 'down') => {
        clearRunErrors()
        const ids = withSwappedAdjacent(
          buttons.map((b) => b.id),
          id,
          direction,
        )
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
      onOpenSettings: () => {
        clearRunErrors()
        settingsState.error = null
        settingsState.successCount = null
        view = { mode: 'settings' }
        void refresh(root)
      },
      onExport: () => {
        try {
          const json = serializeButtons(buttons)
          const blob = new Blob([json], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = 'claude-tools.json'
          link.click()
          URL.revokeObjectURL(url)
        } catch (error) {
          console.error('[Claude Tools] failed to export tools', error)
          settingsState.error = 'Something went wrong exporting your tools. Check the console for details.'
          settingsState.successCount = null
          void refresh(root)
        }
      },
      onImport: async (file: File) => {
        try {
          const text = await file.text()
          const parsed = parseImportedButtons(text)
          for (const { name, prompt } of parsed) {
            await toolService.createButton(name, prompt)
          }
          settingsState.error = null
          settingsState.successCount = parsed.length
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to import tools', error)
          settingsState.error =
            error instanceof Error ? error.message : 'Something went wrong importing that file.'
          settingsState.successCount = null
          await refresh(root)
        }
      },
      onSettingsBack: () => {
        settingsState.error = null
        settingsState.successCount = null
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

Find the existing `.toolbar` rule and replace it (adds a gap between the new settings gear icon and the Add tool button):

```css
.toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 10px;
}
```

Find the existing `.button-row` rule and replace it (removes `justify-content: space-between`, which doesn't make sense with three children now — `.button-row-name`'s existing `flex: 1` already pushes `.button-row-controls` to the end):

```css
.button-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
}
```

Append to the end of the file:

```css
.drag-handle {
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: #6b6b6b;
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
  box-shadow: 0 -2px 0 0 #d97757;
}

.button-row-wrapper.drag-over-bottom {
  box-shadow: 0 2px 0 0 #d97757;
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
  border: 1px solid #d8d8d8;
  border-radius: 6px;
  background: white;
  color: #1a1a1a;
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
  color: #6b6b6b;
}

.settings-error {
  margin: 0;
  font-size: 12px;
  color: #b3261e;
}

.settings-success {
  margin: 0;
  font-size: 12px;
  color: #2e7d32;
}

.settings-back-button {
  align-self: flex-start;
  border: none;
  background: none;
  color: #6b6b6b;
  padding: 4px 0;
  font-size: 13px;
  cursor: pointer;
}
```

- [ ] **Step 6: Build and verify**

Run: `pnpm run build`
Expected: exits 0, no TypeScript errors — confirms `SettingsPanel.ts`, `ButtonRow.ts`, `render.ts`, and `main.ts`'s new signatures all line up correctly across the whole task.

Run: `pnpm test`
Expected: PASS, still 33 tests (no test changes in this task — DOM/UI code stays manual-verification-only, matching this project's established convention).

- [ ] **Step 7: Manual verification**

If you have a real Chrome browser:

1. `pnpm run build`, reload the extension, open the side panel.
2. Click the gear icon — confirm the settings panel appears with Export/Import buttons and a Back button.
3. With at least one tool saved, click Export — confirm a `claude-tools.json` file downloads and its contents match your tools' names/prompts.
4. Click Import and select that same file — confirm it reports "Imported N tools" and the list now has duplicates (expected — import is additive).
5. Try importing a non-JSON file — confirm a clear inline error appears and nothing is added.
6. Back on the list, with at least 3 tools saved, drag one row's handle (⠿) to a different position — confirm a drop-line indicator appears while dragging, and dropping reorders the list correctly; refresh the page and confirm the new order persisted.
7. Tab to a drag handle with the keyboard, confirm a visible focus outline, then press ArrowUp/ArrowDown — confirm the row moves without a mouse. Confirm ArrowUp on the first row (or ArrowDown on the last) does nothing rather than erroring.

If no real Chrome browser is available in this environment, say so explicitly rather than fabricating this check — this is expected and matches every prior UI task in this project.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/SettingsPanel.ts src/sidepanel/ButtonRow.ts src/sidepanel/render.ts src/sidepanel/main.ts src/sidepanel/style.css
git commit -m "feat: add settings panel (export/import) and replace up/down reorder with drag-and-drop plus keyboard-arrow reorder"
```

---

### Task 3: Hover States and Focus-Visible Pass

**Files:**
- Modify: `src/sidepanel/style.css` (append hover/focus rules; no HTML/TS changes — every element these rules target already exists from Tasks 1-2 and Stages 1B/1C/1D)

**Interfaces:** none — this task only adds CSS rules targeting existing class names (`.icon-button`, `.icon-button-danger`, `.add-button`, `.button-row-name`, `.drag-handle`, `.settings-action-button`, `.settings-button`, `.settings-back-button`, `.edit-form-actions button`). No file other than `style.css` changes.

- [ ] **Step 1: Append hover and focus-visible rules to `src/sidepanel/style.css`**

```css
:focus-visible {
  outline: 2px solid #d97757;
  outline-offset: 2px;
}

.icon-button:hover:not(:disabled) {
  background: #f2f2f2;
}

.icon-button-danger:hover:not(:disabled) {
  background: #fbeceb;
}

.add-button:hover {
  background: #c96a4a;
}

.button-row-name:hover:not(:disabled) {
  color: #d97757;
}

.drag-handle:hover {
  background: #f2f2f2;
}

.settings-action-button:hover,
.settings-button:hover {
  background: #f2f2f2;
}

.settings-back-button:hover {
  color: #1a1a1a;
}

.edit-form-actions button[type='button']:hover {
  background: #f2f2f2;
}

.edit-form-actions button[type='submit']:hover {
  background: #c96a4a;
}
```

- [ ] **Step 2: Build and verify**

Run: `pnpm run build`
Expected: exits 0 (CSS changes don't affect TypeScript compilation, but confirms nothing else broke).

Run: `pnpm test`
Expected: PASS, still 33 tests (no test changes in this task).

- [ ] **Step 3: Manual verification**

If you have a real Chrome browser: hover over every button in the panel (icon buttons, Add tool, Delete, the drag handle, settings buttons, form Save/Cancel) — confirm each shows a visible hover state. Tab through every interactive element with the keyboard (don't click anything, just press Tab repeatedly) — confirm each one shows a clearly visible focus outline as it receives focus, including the drag handle and the settings gear icon.

If no real Chrome browser is available, say so explicitly rather than fabricating this check.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/style.css
git commit -m "style: add hover states and focus-visible outlines across the side panel"
```

---

### Task 4: Full Stage 1E Acceptance Pass

**Files:** none (verification only)

**Interfaces:** none — this task exercises everything built in Tasks 1-3 together.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm test`
Expected: PASS, all 33 tests green.

- [ ] **Step 2: Run the build**

Run: `pnpm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Walk the acceptance checklist manually**

Verify each of the following (requires a real Chrome browser):

- [ ] Dragging a row by its handle reorders the list, with a visible drop-line indicator while dragging.
- [ ] Focusing a drag handle with Tab and pressing ArrowUp/ArrowDown reorders the row without a mouse.
- [ ] Reordering (either method) persists after a page refresh.
- [ ] Every interactive element (icon buttons, Add tool, Delete, drag handle, settings gear, Save/Cancel) shows a visible hover state and a visible keyboard focus outline.
- [ ] The run status line ("Running…" or an error) is exposed via `role="status"`/`aria-live="polite"` (verify in DevTools Elements panel, or with a screen reader if available).
- [ ] Clicking the settings gear opens the settings panel; Back returns to the list.
- [ ] Export downloads a `.json` file containing your current tools' names and prompts.
- [ ] Importing that same file adds the tools again (additive, not a replacement) and shows "Imported N tools."
- [ ] Importing a non-JSON or malformed file shows a specific inline error and adds nothing.
- [ ] The side panel remains usable (no broken layout, no overlapping controls) at both a narrow and a wide panel width (drag Chrome's side panel divider to test).
- [ ] Existing Stage 1B/1C/1D functionality (create/edit/delete buttons, click-to-insert) still works unchanged.

- [ ] **Step 4: Record any failures**

If any checklist item fails, do not mark this task complete — identify which task's code is responsible and fix there before considering Stage 1E done.

- [ ] **Step 5: No commit for this task**

Verification-only, no file changes expected. If everything passes, Stage 1E is complete as of Task 3's commit.
