# Stage 1B + 1C: Extension Foundation & Local Button Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a loadable Chrome MV3 extension with a native side panel on claude.ai that lets a user create, edit, delete, and reorder locally-stored prompt buttons — everything except actually inserting/sending prompts into Claude (that is Stage 1D, a separate plan).

**Architecture:** A CRXJS+Vite build produces three runtime contexts — a background service worker (registers the side panel), a content script stub injected into claude.ai (message-listener scaffold only, no DOM logic yet), and the side panel page itself (vanilla TS UI). The side panel talks only to a `ToolService`, which talks only to a `StorageAdapter` interface backed by `chrome.storage.local`, per the approved design spec.

**Tech Stack:** TypeScript 5, Vite 8, `@crxjs/vite-plugin` 2.7.1, Vitest 4, `@types/chrome` 0.2.6. No UI framework, no runtime dependencies beyond the browser/Chrome APIs.

**Spec:** `docs/superpowers/specs/2026-08-16-stage1-architecture-design.md`

## Global Constraints

- MV3 only. Permissions limited to `sidePanel`, `storage`, `scripting`; `host_permissions` limited to `https://claude.ai/*`. No `tabs` permission, no analytics.
- No backend, accounts, or cloud sync — `chrome.storage.local` only.
- No UI framework (no React/Preact) — vanilla TypeScript + direct DOM APIs.
- `ToolService` must depend only on the `StorageAdapter` interface, never on `chrome.storage` directly — this is the seam Stage 2 replaces.
- No boundary (storage, messaging, DOM) may fail silently — every failure path logs to console and, where user-facing, surfaces in the UI.
- Never build `<div>`/element content for user-supplied strings (button name, prompt) via `innerHTML` — use `textContent`/`.value` to avoid XSS.
- Claude-specific DOM selectors do not appear anywhere in this plan's scope — that logic is isolated to `claude-adapter.ts` in the Stage 1D plan, not touched here.

---

### Task 1: Project Scaffolding — Build Produces a Loadable Extension

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `manifest.config.ts`
- Create: `.gitignore`
- Create: `src/background/service-worker.ts`
- Create: `src/content/content-script.ts`
- Create: `src/sidepanel/index.html`
- Create: `src/sidepanel/main.ts`

**Interfaces:**
- Produces: a `dist/` build directory loadable via Chrome's "Load unpacked", and an `ExtensionManifest` TypeScript shape in `manifest.config.ts` that later tasks do not need to touch.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-tools-sidebar",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.7.1",
    "@types/chrome": "^0.2.6",
    "typescript": "^5.7.0",
    "vite": "^8.0.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` is created, `package-lock.json` is created, exit code 0.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["chrome"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src", "tests", "manifest.config.ts", "vite.config.ts"]
}
```

- [ ] **Step 4: Create `manifest.config.ts`**

```ts
interface ExtensionManifest {
  manifest_version: 3
  name: string
  version: string
  description: string
  permissions: string[]
  host_permissions: string[]
  background: {
    service_worker: string
    type: 'module'
  }
  content_scripts: Array<{
    matches: string[]
    js: string[]
  }>
  side_panel: {
    default_path: string
  }
  action: Record<string, never>
}

const manifest: ExtensionManifest = {
  manifest_version: 3,
  name: 'Claude Tools Sidebar',
  version: '0.1.0',
  description: 'Configurable prompt buttons for claude.ai, run from a sidebar.',
  permissions: ['sidePanel', 'storage', 'scripting'],
  host_permissions: ['https://claude.ai/*'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://claude.ai/*'],
      js: ['src/content/content-script.ts'],
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {},
}

export default manifest
```

- [ ] **Step 5: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [
    // Cast past CRXJS's bundled manifest type: side_panel is a valid MV3
    // key but the plugin's own type definitions can lag behind newer
    // manifest keys. Our own ExtensionManifest type is the real safety net.
    crx({ manifest: manifest as ManifestV3Export }),
  ],
})
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
.vite/
*.local
```

- [ ] **Step 7: Create placeholder runtime files so the build has something to bundle**

`src/background/service-worker.ts`:

```ts
console.log('[Claude Tools] service worker loaded')
```

`src/content/content-script.ts`:

```ts
console.log('[Claude Tools] content script loaded on', window.location.href)
```

`src/sidepanel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Claude Tools</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/sidepanel/main.ts`:

```ts
const root = document.getElementById('app')
if (root) {
  root.textContent = 'Claude Tools Sidebar'
}
```

- [ ] **Step 8: Build and verify output**

Run: `npm run build`
Expected: exits 0, creates `dist/manifest.json`, `dist/src/sidepanel/index.html`, and JS chunks for the service worker and content script.

Run: `grep -o '"side_panel"' dist/manifest.json` (or open the file and check)
Expected: the `side_panel` key with `default_path` is present in the built manifest.

- [ ] **Step 9: Load the unpacked extension in Chrome and verify manually**

1. Open `chrome://extensions`, enable **Developer mode** (top right).
2. Click **Load unpacked**, select the `dist/` folder.
3. Confirm: extension loads with no errors shown on the card.
4. Confirm: `chrome://version` shows Chrome 114 or newer (required for `chrome.sidePanel`).

This is a manual check — there is no automated test for "Chrome loads the extension without error."

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts manifest.config.ts .gitignore src
git commit -m "chore: scaffold MV3 extension with Vite + CRXJS"
```

---

### Task 2: Shared Types + StorageAdapter Interface + ChromeLocalStorageAdapter

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/storage/storage-adapter.ts`
- Create: `src/shared/storage/chrome-local-adapter.ts`
- Create: `vitest.config.ts`
- Test: `tests/shared/storage/chrome-local-adapter.test.ts`

**Interfaces:**
- Produces: `Button { id: string; name: string; order: number; prompt: string }`, `StorageAdapter` interface with `getButtons(): Promise<Button[]>`, `saveButton(button: Button): Promise<void>`, `deleteButton(id: string): Promise<void>`, `reorderButtons(orderedIds: string[]): Promise<void>`, and `ChromeLocalStorageAdapter implements StorageAdapter`.

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 2: Create `src/shared/types.ts`**

```ts
export interface Button {
  id: string
  name: string
  order: number
  prompt: string
}
```

- [ ] **Step 3: Create `src/shared/storage/storage-adapter.ts`**

```ts
import type { Button } from '../types'

export interface StorageAdapter {
  getButtons(): Promise<Button[]>
  saveButton(button: Button): Promise<void>
  deleteButton(id: string): Promise<void>
  reorderButtons(orderedIds: string[]): Promise<void>
}
```

- [ ] **Step 4: Write the failing tests for `ChromeLocalStorageAdapter`**

Create `tests/shared/storage/chrome-local-adapter.test.ts`:

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
    const button: Button = { id: '1', name: 'Summarize', order: 0, prompt: 'Summarize this.' }
    await adapter.saveButton(button)
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([button])
  })

  it('overwrites an existing button with the same id', async () => {
    await adapter.saveButton({ id: '1', name: 'Old', order: 0, prompt: 'Old prompt' })
    await adapter.saveButton({ id: '1', name: 'New', order: 0, prompt: 'New prompt' })
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '1', name: 'New', order: 0, prompt: 'New prompt' }])
  })

  it('deletes a button by id', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B' })
    await adapter.deleteButton('1')
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([{ id: '2', name: 'B', order: 1, prompt: 'B' }])
  })

  it('reorders buttons and rewrites their order field', async () => {
    await adapter.saveButton({ id: '1', name: 'A', order: 0, prompt: 'A' })
    await adapter.saveButton({ id: '2', name: 'B', order: 1, prompt: 'B' })
    await adapter.reorderButtons(['2', '1'])
    const buttons = await adapter.getButtons()
    expect(buttons).toEqual([
      { id: '2', name: 'B', order: 0, prompt: 'B' },
      { id: '1', name: 'A', order: 1, prompt: 'A' },
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
    expect(buttons).toEqual([{ id: '1', name: 'Valid', order: 0, prompt: 'ok' }])
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test -- chrome-local-adapter`
Expected: FAIL — `Cannot find module '../../../src/shared/storage/chrome-local-adapter'`

- [ ] **Step 6: Implement `src/shared/storage/chrome-local-adapter.ts`**

```ts
import type { Button } from '../types'
import type { StorageAdapter } from './storage-adapter'

const STORAGE_KEY = 'buttons'

function isButton(value: unknown): value is Button {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.order === 'number' &&
    typeof candidate.prompt === 'string'
  )
}

export class ChromeLocalStorageAdapter implements StorageAdapter {
  async getButtons(): Promise<Button[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    const stored = result[STORAGE_KEY]
    if (!Array.isArray(stored)) return []
    return stored.filter(isButton)
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
    const reordered: Button[] = []
    orderedIds.forEach((id, index) => {
      const button = byId.get(id)
      if (button) reordered.push({ ...button, order: index })
    })
    await chrome.storage.local.set({ [STORAGE_KEY]: reordered })
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- chrome-local-adapter`
Expected: PASS, all 7 tests green.

- [ ] **Step 8: Commit**

```bash
git add src/shared vitest.config.ts tests/shared/storage/chrome-local-adapter.test.ts package.json
git commit -m "feat: add Button type, StorageAdapter interface, and chrome.storage.local adapter"
```

---

### Task 3: ToolService (Business Logic Layer)

**Files:**
- Create: `src/shared/tool-service.ts`
- Create: `tests/support/fake-storage-adapter.ts`
- Test: `tests/shared/tool-service.test.ts`

**Interfaces:**
- Consumes: `StorageAdapter` from Task 2 (`getButtons`, `saveButton`, `deleteButton`, `reorderButtons`); `Button` type from Task 2.
- Produces: `ToolService` with `listButtons(): Promise<Button[]>`, `createButton(name: string, prompt: string): Promise<Button>`, `updateButton(id: string, updates: { name?: string; prompt?: string }): Promise<void>`, `deleteButton(id: string): Promise<void>`, `reorderButtons(orderedIds: string[]): Promise<void>`. This is what Task 6/7's UI code calls — no other task should call `StorageAdapter` directly.

- [ ] **Step 1: Create the in-memory test double**

Create `tests/support/fake-storage-adapter.ts`:

```ts
import type { Button } from '../../src/shared/types'
import type { StorageAdapter } from '../../src/shared/storage/storage-adapter'

export class FakeStorageAdapter implements StorageAdapter {
  private buttons: Button[] = []

  async getButtons(): Promise<Button[]> {
    return this.buttons.map((b) => ({ ...b }))
  }

  async saveButton(button: Button): Promise<void> {
    const index = this.buttons.findIndex((b) => b.id === button.id)
    if (index === -1) {
      this.buttons.push(button)
    } else {
      this.buttons[index] = button
    }
  }

  async deleteButton(id: string): Promise<void> {
    this.buttons = this.buttons.filter((b) => b.id !== id)
  }

  async reorderButtons(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.buttons.map((b) => [b.id, b]))
    this.buttons = orderedIds
      .map((id, index) => {
        const button = byId.get(id)
        return button ? { ...button, order: index } : undefined
      })
      .filter((b): b is Button => b !== undefined)
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/shared/tool-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { ToolService } from '../../src/shared/tool-service'
import { FakeStorageAdapter } from '../support/fake-storage-adapter'

describe('ToolService', () => {
  let storage: FakeStorageAdapter
  let service: ToolService

  beforeEach(() => {
    storage = new FakeStorageAdapter()
    service = new ToolService(storage)
  })

  it('creates a button with an incrementing order and a generated id', async () => {
    const first = await service.createButton('Summarize', 'Summarize this.')
    const second = await service.createButton('Translate', 'Translate this.')
    expect(first.order).toBe(0)
    expect(second.order).toBe(1)
    expect(first.id).not.toBe(second.id)
    expect(first.name).toBe('Summarize')
    expect(first.prompt).toBe('Summarize this.')
  })

  it('lists buttons sorted by order', async () => {
    await storage.saveButton({ id: 'b', name: 'B', order: 1, prompt: 'b' })
    await storage.saveButton({ id: 'a', name: 'A', order: 0, prompt: 'a' })
    const buttons = await service.listButtons()
    expect(buttons.map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('updates an existing button, preserving fields not passed', async () => {
    const created = await service.createButton('Name', 'Prompt')
    await service.updateButton(created.id, { name: 'New Name' })
    const [button] = await service.listButtons()
    expect(button.name).toBe('New Name')
    expect(button.prompt).toBe('Prompt')
  })

  it('throws when updating a button that does not exist', async () => {
    await expect(service.updateButton('missing-id', { name: 'X' })).rejects.toThrow(
      'Button not found: missing-id',
    )
  })

  it('deletes a button', async () => {
    const created = await service.createButton('Name', 'Prompt')
    await service.deleteButton(created.id)
    expect(await service.listButtons()).toEqual([])
  })

  it('reorders buttons', async () => {
    const a = await service.createButton('A', 'a')
    const b = await service.createButton('B', 'b')
    await service.reorderButtons([b.id, a.id])
    const buttons = await service.listButtons()
    expect(buttons.map((btn) => btn.id)).toEqual([b.id, a.id])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tool-service`
Expected: FAIL — `Cannot find module '../../src/shared/tool-service'`

- [ ] **Step 4: Implement `src/shared/tool-service.ts`**

```ts
import type { Button } from './types'
import type { StorageAdapter } from './storage/storage-adapter'

export class ToolService {
  constructor(private readonly storage: StorageAdapter) {}

  async listButtons(): Promise<Button[]> {
    const buttons = await this.storage.getButtons()
    return [...buttons].sort((a, b) => a.order - b.order)
  }

  async createButton(name: string, prompt: string): Promise<Button> {
    const existing = await this.storage.getButtons()
    const button: Button = {
      id: crypto.randomUUID(),
      name,
      order: existing.length,
      prompt,
    }
    await this.storage.saveButton(button)
    return button
  }

  async updateButton(id: string, updates: { name?: string; prompt?: string }): Promise<void> {
    const buttons = await this.storage.getButtons()
    const button = buttons.find((b) => b.id === id)
    if (!button) throw new Error(`Button not found: ${id}`)
    await this.storage.saveButton({
      ...button,
      name: updates.name ?? button.name,
      prompt: updates.prompt ?? button.prompt,
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tool-service`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS, 13 tests total (7 from Task 2 + 6 from this task).

- [ ] **Step 7: Commit**

```bash
git add src/shared/tool-service.ts tests/support/fake-storage-adapter.ts tests/shared/tool-service.test.ts
git commit -m "feat: add ToolService business logic layer"
```

---

### Task 4: Background Service Worker — Side Panel Registration

**Files:**
- Modify: `src/background/service-worker.ts` (replace placeholder from Task 1)

**Interfaces:**
- Consumes: nothing from earlier tasks (uses `chrome.sidePanel`, `chrome.tabs` globals only).
- Produces: side panel enabled only on `https://claude.ai/*` tabs, opens on toolbar icon click.

- [ ] **Step 1: Replace the placeholder service worker**

Replace the full contents of `src/background/service-worker.ts`:

```ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[Claude Tools] failed to set side panel behavior', error)
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return
  const isClaudeTab = tab.url?.startsWith('https://claude.ai/') ?? false
  chrome.sidePanel
    .setOptions({
      tabId,
      path: 'src/sidepanel/index.html',
      enabled: isClaudeTab,
    })
    .catch((error) => {
      console.error('[Claude Tools] failed to update side panel options for tab', tabId, error)
    })
})
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Manually verify in Chrome**

1. In `chrome://extensions`, click the reload icon on the extension card.
2. Open `chrome://extensions`, click "service worker" link on the extension card to open its DevTools; confirm no errors logged.
3. Open a new tab to `https://claude.ai`, click the extension's toolbar icon: confirm the side panel opens showing "Claude Tools Sidebar" (the Task 1 placeholder text).
4. Open a new tab to any non-claude.ai site (e.g. `https://example.com`), click the extension's toolbar icon: confirm the side panel does **not** open for that tab.
5. Switch back to the claude.ai tab: confirm the side panel is still available/open there.

This is a manual check — `chrome.sidePanel` behavior cannot be exercised from Vitest's Node environment.

- [ ] **Step 4: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat: register side panel behavior scoped to claude.ai tabs"
```

---

### Task 5: Content Script Scaffold

**Files:**
- Modify: `src/content/content-script.ts` (replace placeholder from Task 1)

**Interfaces:**
- Produces: a `chrome.runtime.onMessage` listener for a future `{ type: 'INSERT_AND_SEND', prompt: string }` message, which the side panel (Task 7) does **not** call yet — full DOM insertion logic is Stage 1D, a separate plan. This task only proves the wiring exists and responds safely.

- [ ] **Step 1: Replace the placeholder content script**

Replace the full contents of `src/content/content-script.ts`:

```ts
console.log('[Claude Tools] content script loaded on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'INSERT_AND_SEND') return undefined
  console.warn('[Claude Tools] INSERT_AND_SEND is not implemented yet (Stage 1D)')
  sendResponse({ ok: false, error: 'not_implemented' })
  return true
})
```

- [ ] **Step 2: Build and manually verify**

Run: `npm run build`, then reload the extension in `chrome://extensions`.

1. Open `https://claude.ai`, open the page's DevTools console.
2. Confirm the log line `[Claude Tools] content script loaded on https://claude.ai/...` appears.
3. Refresh the page: confirm the log line appears again (proves the content script survives a page reload).

Note the limit of this verification honestly: the `INSERT_AND_SEND` listener itself is not exercised by anything in this plan — nothing calls `chrome.tabs.sendMessage` yet, since that caller is the side panel's Stage 1D "run this button" action, which is out of scope here. Steps 1–3 confirm the script injects and survives reloads; the listener's actual behavior gets its first real exercise once Stage 1D wires a caller.

- [ ] **Step 3: Commit**

```bash
git add src/content/content-script.ts
git commit -m "feat: add content script scaffold with INSERT_AND_SEND message stub"
```

---

### Task 6: Side Panel Shell — Read-Only Button List

**Files:**
- Modify: `src/sidepanel/main.ts` (replace placeholder from Task 1)
- Modify: `src/sidepanel/index.html` (add stylesheet link)
- Create: `src/sidepanel/render.ts`
- Create: `src/sidepanel/style.css`

**Interfaces:**
- Consumes: `ToolService.listButtons(): Promise<Button[]>` from Task 3; `ChromeLocalStorageAdapter` from Task 2.
- Produces: `renderApp(root: HTMLElement, buttons: Button[]): void` — a minimal read-only renderer that Task 7 will extend with a `view` state parameter and interactive controls.

- [ ] **Step 1: Create `src/sidepanel/render.ts`**

```ts
import type { Button } from '../shared/types'

export function renderApp(root: HTMLElement, buttons: Button[]): void {
  root.innerHTML = ''

  if (buttons.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'No tools yet. Buttons you add will show up here.'
    root.appendChild(empty)
    return
  }

  const list = document.createElement('ul')
  list.className = 'button-list'
  for (const button of buttons) {
    const item = document.createElement('li')
    item.className = 'button-row'
    const name = document.createElement('span')
    name.className = 'button-row-name'
    name.textContent = button.name
    item.appendChild(name)
    list.appendChild(item)
  }
  root.appendChild(list)
}
```

- [ ] **Step 2: Create `src/sidepanel/style.css`**

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
}

body {
  margin: 0;
  padding: 12px;
}

.empty-state {
  color: #6b6b6b;
  font-size: 13px;
}

.button-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Add the stylesheet link to `src/sidepanel/index.html`**

Replace the full contents of `src/sidepanel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Claude Tools</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Replace `src/sidepanel/main.ts`**

```ts
import { ToolService } from '../shared/tool-service'
import { ChromeLocalStorageAdapter } from '../shared/storage/chrome-local-adapter'
import { renderApp } from './render'

const toolService = new ToolService(new ChromeLocalStorageAdapter())
const root = document.getElementById('app')

if (!root) {
  throw new Error('[Claude Tools] sidepanel root element (#app) is missing')
}

async function refresh(): Promise<void> {
  try {
    const buttons = await toolService.listButtons()
    renderApp(root, buttons)
  } catch (error) {
    console.error('[Claude Tools] failed to load buttons', error)
    root.textContent = 'Something went wrong loading your tools. Check the console for details.'
  }
}

void refresh()
```

- [ ] **Step 5: Build and manually verify**

Run: `npm run build`, reload the extension in `chrome://extensions`.

1. Open `https://claude.ai`, open the side panel: confirm it shows "No tools yet. Buttons you add will show up here."
2. Open the side panel's own DevTools (right-click inside the panel → Inspect), go to the Console, and run:
   ```js
   chrome.storage.local.set({ buttons: [{ id: '1', name: 'Test Button', order: 0, prompt: 'hi' }] })
   ```
3. Close and reopen the side panel: confirm "Test Button" now appears in the list instead of the empty state.
4. Refresh the claude.ai page: confirm the side panel still shows "Test Button" (proves persistence survives page refresh).
5. Run `chrome.storage.local.set({ buttons: 'garbage' })` in the panel's console, reopen the panel: confirm it shows the empty state (not a crash) — this exercises the corrupt-data handling from Task 2.
6. Clean up: run `chrome.storage.local.remove('buttons')` in the panel's console.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel
git commit -m "feat: render side panel button list from ToolService"
```

---

### Task 7: Full CRUD + Reorder UI

**Files:**
- Create: `src/sidepanel/ButtonRow.ts`
- Create: `src/sidepanel/EditForm.ts`
- Modify: `src/sidepanel/render.ts` (full rewrite, adds view-state handling)
- Modify: `src/sidepanel/main.ts` (full rewrite, wires all callbacks to `ToolService`)
- Modify: `src/sidepanel/style.css` (append form/controls styles)

**Interfaces:**
- Consumes: `ToolService.createButton`, `.updateButton`, `.deleteButton`, `.reorderButtons`, `.listButtons` from Task 3; `Button` type from Task 2.
- Produces: `renderButtonRow(button: Button, context: ButtonRowContext): HTMLElement`, `renderEditForm(button: Button | null, context: EditFormContext): HTMLElement`, `renderApp(root: HTMLElement, buttons: Button[], view: View, context: RenderContext): void`, `type View = { mode: 'list' } | { mode: 'form'; button: Button | null }`.

- [ ] **Step 1: Create `src/sidepanel/ButtonRow.ts`**

```ts
import type { Button } from '../shared/types'

export interface ButtonRowContext {
  isFirst: boolean
  isLast: boolean
  onEdit: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function renderButtonRow(button: Button, context: ButtonRowContext): HTMLElement {
  const item = document.createElement('li')
  item.className = 'button-row'

  const name = document.createElement('span')
  name.className = 'button-row-name'
  name.textContent = button.name
  item.appendChild(name)

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

  item.appendChild(controls)
  return item
}
```

- [ ] **Step 2: Create `src/sidepanel/EditForm.ts`**

```ts
import type { Button } from '../shared/types'

export interface EditFormContext {
  onSave: (data: { id: string | null; name: string; prompt: string }) => void
  onCancel: () => void
}

export function renderEditForm(button: Button | null, context: EditFormContext): HTMLElement {
  const form = document.createElement('form')
  form.className = 'edit-form'

  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Name'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.required = true
  nameInput.value = button?.name ?? ''
  nameLabel.appendChild(nameInput)
  form.appendChild(nameLabel)

  const promptLabel = document.createElement('label')
  promptLabel.textContent = 'Prompt'
  const promptInput = document.createElement('textarea')
  promptInput.required = true
  promptInput.rows = 8
  promptInput.value = button?.prompt ?? ''
  promptLabel.appendChild(promptInput)
  form.appendChild(promptLabel)

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
    })
  })

  return form
}
```

- [ ] **Step 3: Replace `src/sidepanel/render.ts`**

```ts
import type { Button } from '../shared/types'
import { renderButtonRow } from './ButtonRow'
import { renderEditForm } from './EditForm'

export type View = { mode: 'list' } | { mode: 'form'; button: Button | null }

export interface RenderContext {
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
    list.appendChild(
      renderButtonRow(button, {
        isFirst: index === 0,
        isLast: index === buttons.length - 1,
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

- [ ] **Step 4: Replace `src/sidepanel/main.ts`**

```ts
import { ToolService } from '../shared/tool-service'
import { ChromeLocalStorageAdapter } from '../shared/storage/chrome-local-adapter'
import { renderApp, type View } from './render'
import type { Button } from '../shared/types'

const toolService = new ToolService(new ChromeLocalStorageAdapter())
const root = document.getElementById('app')

if (!root) {
  throw new Error('[Claude Tools] sidepanel root element (#app) is missing')
}

let view: View = { mode: 'list' }

async function refresh(): Promise<void> {
  try {
    const buttons = await toolService.listButtons()
    renderApp(root, buttons, view, {
      onAddClick: () => {
        view = { mode: 'form', button: null }
        void refresh()
      },
      onEdit: (button: Button) => {
        view = { mode: 'form', button }
        void refresh()
      },
      onDelete: async (button: Button) => {
        const confirmed = window.confirm(`Delete "${button.name}"? This cannot be undone.`)
        if (!confirmed) return
        await toolService.deleteButton(button.id)
        await refresh()
      },
      onMoveUp: async (button: Button) => {
        const ids = buttons.map((b) => b.id)
        const index = ids.indexOf(button.id)
        if (index <= 0) return
        ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
        await toolService.reorderButtons(ids)
        await refresh()
      },
      onMoveDown: async (button: Button) => {
        const ids = buttons.map((b) => b.id)
        const index = ids.indexOf(button.id)
        if (index === -1 || index >= ids.length - 1) return
        ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
        await toolService.reorderButtons(ids)
        await refresh()
      },
      onSave: async (data) => {
        if (!data.name || !data.prompt) return
        if (data.id) {
          await toolService.updateButton(data.id, { name: data.name, prompt: data.prompt })
        } else {
          await toolService.createButton(data.name, data.prompt)
        }
        view = { mode: 'list' }
        await refresh()
      },
      onCancel: () => {
        view = { mode: 'list' }
        void refresh()
      },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to load buttons', error)
    root.textContent = 'Something went wrong loading your tools. Check the console for details.'
  }
}

void refresh()
```

- [ ] **Step 5: Append form/controls styles to `src/sidepanel/style.css`**

Append to the end of the existing file:

```css
.toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.add-button {
  border: none;
  border-radius: 6px;
  background: #d97757;
  color: white;
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
  border: 1px solid #d8d8d8;
  border-radius: 6px;
  background: white;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.icon-button-danger {
  color: #b3261e;
  border-color: #eac6c2;
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
}

.edit-form input,
.edit-form textarea {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid #d8d8d8;
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
  background: #d97757;
  color: white;
}

.edit-form-actions button[type='button'] {
  border: 1px solid #d8d8d8;
  background: white;
}
```

- [ ] **Step 6: Build and manually verify the full CRUD + reorder flow**

Run: `npm run build`, reload the extension in `chrome://extensions`, open `https://claude.ai`, open the side panel.

1. **Create:** click "+ Add tool", fill in Name "Summarize" and Prompt "Summarize this page.", click Save. Confirm it appears in the list.
2. **Create a second:** repeat with Name "Translate", Prompt "Translate this to French.". Confirm both appear, "Summarize" first.
3. **Edit:** click Edit on "Summarize", change the name to "Summarize Page", Save. Confirm the list shows the updated name.
4. **Reorder:** click ↓ on "Summarize Page". Confirm "Translate" now appears first.
5. **Reorder boundary:** confirm the ↑ button on the first row and the ↓ button on the last row are disabled (grayed out, unclickable).
6. **Delete with cancel:** click Delete on either row, click Cancel in the browser confirm dialog. Confirm the button is still there.
7. **Delete confirmed:** click Delete again, click OK. Confirm the button is removed and the other one remains.
8. **Persistence:** refresh the claude.ai page, reopen the side panel. Confirm the remaining button and its order survived.
9. **Empty state:** delete the last remaining button. Confirm the empty state message reappears.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel
git commit -m "feat: add full button CRUD and reorder UI to side panel"
```

---

### Task 8: Full Stage 1B + 1C Acceptance Pass

**Files:** none (verification only)

**Interfaces:** none — this task exercises everything built in Tasks 1–7 together.

- [ ] **Step 1: Run the full automated test suite one more time**

Run: `npm test`
Expected: PASS, all tests green (13 tests from Tasks 2–3).

- [ ] **Step 2: Run the build one more time**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Fresh-install check**

1. In `chrome://extensions`, remove the extension entirely, then "Load unpacked" the `dist/` folder again from scratch (simulates a new user installing it).
2. Confirm no errors on install.

- [ ] **Step 4: Walk the master-prompt acceptance checklist**

Verify each of the following manually and note the result:

- [ ] Sidebar opens on claude.ai (click toolbar icon).
- [ ] Sidebar does not open on non-claude.ai tabs.
- [ ] Sidebar does not visually break or overlap Claude's own UI (compare the page layout with the panel open vs. closed).
- [ ] Existing Claude functionality (typing in the chat box, sending a real message) still works normally with the panel open.
- [ ] Refreshing the claude.ai page does not break the side panel (reopen it, confirm it still works).
- [ ] Navigating between two different Claude conversations (click between chats in Claude's own sidebar) does not close or break the extension's side panel.
- [ ] Creating a button works.
- [ ] Editing a button works.
- [ ] Deleting a button works (with confirmation).
- [ ] Reordering works (both directions, boundary buttons disabled correctly).
- [ ] Data persists after closing and reopening the browser entirely (quit Chrome, relaunch, open claude.ai, open the panel).
- [ ] Multiple buttons behave independently (editing one does not affect another).
- [ ] Setting `chrome.storage.local` to malformed data (via the panel's own DevTools console) does not crash the panel — it falls back to the empty state.

- [ ] **Step 5: Record any failures**

If any checklist item fails, do not mark this task complete — file it as a bug against the specific task that introduced it and fix there before proceeding to Stage 1D.

- [ ] **Step 6: No commit for this task**

This task is verification-only and creates no file changes. If Step 4's checklist passes in full, Stage 1B and 1C are complete as of Task 7's commit — there is nothing further to commit here. If any item failed and required a fix, that fix was committed from within the task that owns the affected file (Task 1–7), not from here.

---

## What's Explicitly Out of Scope Here

- **Stage 1D** (inserting/sending prompts into Claude's actual chat input) — the content script ships as a stub only; `claude-adapter.ts` and its ProseMirror-aware insertion logic are a separate plan, even though the DOM selectors are already confirmed in the design spec.
- **Stage 1E** (drag-and-drop reorder, animations, richer visual polish) — Task 7 ships up/down buttons for reordering, which satisfies the Stage 1C acceptance criteria; drag-and-drop is deliberately deferred.
- **Stage 1G** (README/docs) — not part of this plan.
