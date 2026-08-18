# Phase 2A: Personal Usage Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the signed-in claude.ai user their own session/weekly/spend usage in the sidebar, in both the normal (expanded) layout and a new manually-toggled collapsed icon-rail layout.

**Architecture:** The content script fetches claude.ai's own internal usage endpoint (cookie-authenticated, no new permissions) and normalizes it into a small typed shape. The sidepanel requests this over the existing message-passing pattern, renders it as a card of progress bars in the expanded view, and as ring gauges in a new collapsed rail view toggled by a stored boolean preference — not by detecting the panel's actual width, which Chrome doesn't expose reliably to extensions.

**Tech Stack:** TypeScript + Vite (CRXJS), pnpm, vanilla TS + DOM, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-usage-indicator-design.md` (primary — data model, endpoint details, severity handling, refresh cadence, error handling). `docs/superpowers/specs/2026-08-18-phase2-login-team-storage-design.md` is context only; nothing in it is implemented by this plan.

## Global Constraints

- Package manager is pnpm — never npm.
- No new npm dependencies.
- No new manifest permissions — `https://claude.ai/*` already covers the usage endpoint.
- Collapsed mode is a **manual toggle only**: a boolean preference in `chrome.storage.local`. It must never depend on reading the side panel's actual rendered width — Chrome does not expose that reliably to extensions.
- The collapsed layout applies **only** to the list view. Opening Add/Edit (`view.mode === 'form'`) or Settings (`view.mode === 'settings'`) always renders expanded, regardless of the stored preference. Returning to the list view re-applies the stored preference.
- The usage card/rings have no error or loading UI. If data isn't available yet, or a fetch fails, they simply don't render — never a visible error state, never blocking any other part of the sidebar.
- Severity → color mapping (three-way): `severity === 'normal'` → `--success`; `severity === 'warning'` → `--warning` (new token, added in Task 3); anything else (including values never observed, e.g. `'critical'` or an unrecognized string) → `--danger`. Unknown severities are treated as the most urgent, not the least.
- Testing convention: pure logic gets full TDD coverage in `tests/shared/`. Content-script wiring and sidepanel UI are manual-verification-only, matching every prior UI task in this project — there is no DOM testing infrastructure in this repo and none should be added.
- Run `pnpm test` and `pnpm run build` (`tsc --noEmit && vite build`) at the end of every task; both must be clean before committing.

---

### Task 1: Usage response parsing

**Files:**
- Create: `src/shared/usage.ts`
- Test: `tests/shared/usage.test.ts`

**Interfaces:**
- Produces: `UsageMeter` (`{ label: string; percent: number; severity: string; resetsAt: string | null }`), `UsageSnapshot` (`{ meters: UsageMeter[] }`), `parseUsageResponse(raw: unknown): UsageSnapshot` — all consumed by Task 2 (content script) and Task 3 (sidepanel/UI).

- [ ] **Step 1: Write the failing tests**

Create `tests/shared/usage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseUsageResponse } from '../../src/shared/usage'

const REAL_RESPONSE = {
  five_hour: {
    utilization: 12,
    resets_at: '2026-08-18T14:10:00.150665+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day: {
    utilization: 25,
    resets_at: '2026-08-19T23:00:00.150689+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  tangelo: null,
  nimbus_quill: { utilization: 0, resets_at: null, limit_dollars: null, used_dollars: null, remaining_dollars: null },
  limits: [
    {
      kind: 'session',
      group: 'session',
      percent: 12,
      severity: 'normal',
      resets_at: '2026-08-18T14:10:00.150665+00:00',
      scope: null,
      is_active: false,
    },
    {
      kind: 'weekly_all',
      group: 'weekly',
      percent: 25,
      severity: 'normal',
      resets_at: '2026-08-19T23:00:00.150689+00:00',
      scope: null,
      is_active: true,
    },
  ],
  spend: {
    used: { amount_minor: 2929, currency: 'AUD', exponent: 2 },
    limit: { amount_minor: 4000, currency: 'AUD', exponent: 2 },
    percent: 73,
    severity: 'normal',
    enabled: true,
    disabled_reason: null,
  },
  member_dashboard_available: false,
}

describe('parseUsageResponse', () => {
  it('builds a meter for each entry in limits, with a friendly label', () => {
    const result = parseUsageResponse(REAL_RESPONSE)
    expect(result.meters).toContainEqual({
      label: 'Session',
      percent: 12,
      severity: 'normal',
      resetsAt: '2026-08-18T14:10:00.150665+00:00',
    })
    expect(result.meters).toContainEqual({
      label: 'Weekly',
      percent: 25,
      severity: 'normal',
      resetsAt: '2026-08-19T23:00:00.150689+00:00',
    })
  })

  it('includes an "Extra usage" meter when spend is enabled', () => {
    const result = parseUsageResponse(REAL_RESPONSE)
    expect(result.meters).toContainEqual({
      label: 'Extra usage',
      percent: 73,
      severity: 'normal',
      resetsAt: null,
    })
  })

  it('omits the spend meter when spend.enabled is false', () => {
    const response = { ...REAL_RESPONSE, spend: { ...REAL_RESPONSE.spend, enabled: false } }
    const result = parseUsageResponse(response)
    expect(result.meters.find((m) => m.label === 'Extra usage')).toBeUndefined()
  })

  it('omits the spend meter when spend is missing entirely', () => {
    const { spend: _spend, ...rest } = REAL_RESPONSE
    const result = parseUsageResponse(rest)
    expect(result.meters.find((m) => m.label === 'Extra usage')).toBeUndefined()
  })

  it('ignores unrecognized fields like internal codenames, producing exactly the 3 known meters', () => {
    const result = parseUsageResponse(REAL_RESPONSE)
    expect(result.meters).toHaveLength(3)
  })

  it('passes severity through as-is, even at a high percentage', () => {
    const response = { ...REAL_RESPONSE, spend: { ...REAL_RESPONSE.spend, percent: 95, severity: 'normal' } }
    const result = parseUsageResponse(response)
    const spendMeter = result.meters.find((m) => m.label === 'Extra usage')
    expect(spendMeter?.severity).toBe('normal')
  })

  it('falls back to the raw kind as the label for an unrecognized limit kind', () => {
    const response = {
      limits: [{ kind: 'mystery_limit', percent: 50, severity: 'normal', resets_at: null }],
    }
    const result = parseUsageResponse(response)
    expect(result.meters).toEqual([{ label: 'mystery_limit', percent: 50, severity: 'normal', resetsAt: null }])
  })

  it('skips a limits entry missing a required field instead of throwing', () => {
    const response = { limits: [{ kind: 'session', percent: 12 }] }
    expect(() => parseUsageResponse(response)).not.toThrow()
    expect(parseUsageResponse(response).meters).toEqual([])
  })

  it('returns no meters for a response with no limits and no spend', () => {
    expect(parseUsageResponse({})).toEqual({ meters: [] })
  })

  it('returns no meters when given non-object input, without throwing', () => {
    expect(parseUsageResponse(null)).toEqual({ meters: [] })
    expect(parseUsageResponse('not an object')).toEqual({ meters: [] })
    expect(parseUsageResponse(undefined)).toEqual({ meters: [] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- usage.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/usage'`

- [ ] **Step 3: Implement `parseUsageResponse`**

Create `src/shared/usage.ts`:

```ts
export interface UsageMeter {
  label: string
  percent: number
  severity: string
  resetsAt: string | null
}

export interface UsageSnapshot {
  meters: UsageMeter[]
}

const LIMIT_LABELS: Record<string, string> = {
  session: 'Session',
  weekly_all: 'Weekly',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseLimitEntry(entry: unknown): UsageMeter | null {
  if (!isRecord(entry)) return null
  const kind = entry.kind
  const percent = entry.percent
  const severity = entry.severity
  if (typeof kind !== 'string' || typeof percent !== 'number' || typeof severity !== 'string') return null
  const resetsAt = typeof entry.resets_at === 'string' ? entry.resets_at : null
  return { label: LIMIT_LABELS[kind] ?? kind, percent, severity, resetsAt }
}

function parseSpendMeter(spend: unknown): UsageMeter | null {
  if (!isRecord(spend) || spend.enabled !== true) return null
  const percent = spend.percent
  const severity = spend.severity
  if (typeof percent !== 'number' || typeof severity !== 'string') return null
  return { label: 'Extra usage', percent, severity, resetsAt: null }
}

export function parseUsageResponse(raw: unknown): UsageSnapshot {
  if (!isRecord(raw)) return { meters: [] }

  const meters: UsageMeter[] = []

  if (Array.isArray(raw.limits)) {
    for (const entry of raw.limits) {
      const meter = parseLimitEntry(entry)
      if (meter) meters.push(meter)
    }
  }

  const spendMeter = parseSpendMeter(raw.spend)
  if (spendMeter) meters.push(spendMeter)

  return { meters }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- usage.test.ts`
Expected: PASS, all 10 tests green.

- [ ] **Step 5: Run the full suite and build, then commit**

Run: `pnpm test && pnpm run build`
Expected: all existing tests still pass, build succeeds.

```bash
git add src/shared/usage.ts tests/shared/usage.test.ts
git commit -m "feat: add parseUsageResponse for claude.ai's usage endpoint"
```

---

### Task 2: Message type + content script fetch handler

**Files:**
- Modify: `src/shared/messages.ts`
- Create: `src/content/usage-client.ts`
- Modify: `src/content/content-script.ts`

**Interfaces:**
- Consumes: `UsageSnapshot`, `parseUsageResponse` from Task 1 (`src/shared/usage.ts`).
- Produces: `GetUsageRequest` (`{ type: 'GET_USAGE' }`), `GetUsageResponse` (`{ ok: true; usage: UsageSnapshot } | { ok: false }`) — consumed by Task 3 (sidepanel). `fetchUsage(): Promise<GetUsageResponse>` — consumed only within this task's content-script handler.

This task is manual-verification-only (message passing and `fetch` against a live claude.ai session can't be unit tested in this repo's Node-based Vitest setup — no jsdom, no DOM/network test infrastructure, matching every prior content-script task).

- [ ] **Step 1: Add the message types**

In `src/shared/messages.ts`, add below the existing `InsertPromptResponse` type:

```ts
import type { UsageSnapshot } from './usage'

export interface GetUsageRequest {
  type: 'GET_USAGE'
}

export type GetUsageResponse = { ok: true; usage: UsageSnapshot } | { ok: false }
```

(Add the `import type { UsageSnapshot } from './usage'` line at the top of the file, alongside no other existing imports — `messages.ts` currently has none.)

- [ ] **Step 2: Write the usage-fetching client**

Create `src/content/usage-client.ts`:

```ts
import { parseUsageResponse } from '../shared/usage'
import type { GetUsageResponse } from '../shared/messages'

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export async function fetchUsage(): Promise<GetUsageResponse> {
  const orgId = readCookie('lastActiveOrg')
  if (!orgId) {
    console.warn('[Claude Tools] no lastActiveOrg cookie found; cannot fetch usage')
    return { ok: false }
  }

  let response: Response
  try {
    response = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
      credentials: 'include',
    })
  } catch (error) {
    console.error('[Claude Tools] usage fetch failed', error)
    return { ok: false }
  }

  if (!response.ok) {
    console.error('[Claude Tools] usage endpoint returned status', response.status)
    return { ok: false }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    console.error('[Claude Tools] usage response was not valid JSON', error)
    return { ok: false }
  }

  return { ok: true, usage: parseUsageResponse(body) }
}
```

- [ ] **Step 3: Wire it into the content script's message handler**

Replace the full contents of `src/content/content-script.ts`:

```ts
import { insertPrompt } from './claude-adapter'
import { fetchUsage } from './usage-client'
import type { InsertPromptRequest } from '../shared/messages'

console.log('[Claude Tools] content script loaded on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof (message as { type?: unknown }).type !== 'string') return undefined
  const type = (message as { type: string }).type

  if (type === 'INSERT_PROMPT') {
    const { prompt } = message as InsertPromptRequest
    insertPrompt(prompt)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Claude Tools] unexpected error during insertPrompt', error)
        sendResponse({
          ok: false,
          error: 'insert_failed',
          message: 'Something went wrong inserting the prompt. Check the console for details.',
        })
      })
    return true
  }

  if (type === 'GET_USAGE') {
    fetchUsage()
      .then(sendResponse)
      .catch((error) => {
        console.error('[Claude Tools] unexpected error fetching usage', error)
        sendResponse({ ok: false })
      })
    return true
  }

  return undefined
})
```

- [ ] **Step 4: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: all tests still pass (this task adds no new automated tests — see task header), build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/messages.ts src/content/usage-client.ts src/content/content-script.ts
git commit -m "feat: add GET_USAGE message handling to the content script"
```

---

### Task 3: Expanded usage card in the sidepanel

**Files:**
- Create: `src/sidepanel/UsageCard.ts`
- Modify: `src/sidepanel/render.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/style.css`

**Interfaces:**
- Consumes: `UsageSnapshot`, `UsageMeter` (Task 1); `GetUsageRequest`, `GetUsageResponse` (Task 2).
- Produces: `renderUsageCard(usage: UsageSnapshot): HTMLElement`. `renderApp`'s signature changes — Task 4 depends on the new signature below.

This task is manual-verification-only (DOM rendering and `chrome.tabs.sendMessage`, same as every prior sidepanel UI task).

- [ ] **Step 1: Add the `--warning` token**

In `src/sidepanel/style.css`, in the `:root` block, add a line after `--success: #2e7d32;`:

```css
  --warning: #b3720f;
```

In the `@media (prefers-color-scheme: dark)` block, add a line after `--success: #6fbf73;`:

```css
    --warning: #e3ab52;
```

- [ ] **Step 2: Add usage card CSS**

In `src/sidepanel/style.css`, add after the `.skill-badge { ... }` rule:

```css
.usage-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--surface-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.usage-card-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.usage-card-label {
  width: 74px;
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--text-muted);
}

.usage-card-track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: var(--surface-hover);
  overflow: hidden;
}

.usage-card-fill {
  height: 100%;
  border-radius: 3px;
}

.usage-card-fill-normal {
  background: var(--success);
}

.usage-card-fill-warning {
  background: var(--warning);
}

.usage-card-fill-critical {
  background: var(--danger);
}

.usage-card-pct {
  width: 34px;
  text-align: right;
  font-size: 11.5px;
  font-weight: 600;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Write `UsageCard.ts`**

Create `src/sidepanel/UsageCard.ts`:

```ts
import type { UsageSnapshot } from '../shared/usage'

export function severityClass(severity: string): 'normal' | 'warning' | 'critical' {
  if (severity === 'normal') return 'normal'
  if (severity === 'warning') return 'warning'
  return 'critical'
}

export function renderUsageCard(usage: UsageSnapshot): HTMLElement {
  const card = document.createElement('div')
  card.className = 'usage-card'

  usage.meters.forEach((meter) => {
    const row = document.createElement('div')
    row.className = 'usage-card-row'

    const label = document.createElement('span')
    label.className = 'usage-card-label'
    label.textContent = meter.label
    row.appendChild(label)

    const clamped = Math.min(100, Math.max(0, meter.percent))
    const track = document.createElement('div')
    track.className = 'usage-card-track'
    const fill = document.createElement('div')
    fill.className = `usage-card-fill usage-card-fill-${severityClass(meter.severity)}`
    fill.style.width = `${clamped}%`
    track.appendChild(fill)
    row.appendChild(track)

    const pct = document.createElement('span')
    pct.className = 'usage-card-pct'
    pct.textContent = `${Math.round(clamped)}%`
    row.appendChild(pct)

    card.appendChild(row)
  })

  return card
}
```

- [ ] **Step 4: Thread `usage` through `render.ts`**

In `src/sidepanel/render.ts`:

Add the import at the top, alongside the existing imports:

```ts
import type { UsageSnapshot } from '../shared/usage'
import { renderUsageCard } from './UsageCard'
```

Change the `renderApp` function signature (currently `root, buttons, view, runState, settingsState, context`) to insert `usage` before `context`:

```ts
export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  usage: UsageSnapshot | null,
  context: RenderContext,
): void {
```

Inside the function, after the existing `root.appendChild(header)` line (right after the toolbar is built, before the `if (buttons.length === 0)` check), insert:

```ts
  if (usage && usage.meters.length > 0) {
    root.appendChild(renderUsageCard(usage))
  }
```

- [ ] **Step 5: Wire it up in `main.ts`**

In `src/sidepanel/main.ts`, add the import at the top:

```ts
import type { UsageSnapshot } from '../shared/usage'
import type { GetUsageRequest, GetUsageResponse } from '../shared/messages'
```

Add a module-level variable near the existing `let view: View = { mode: 'list' }` line:

```ts
let usage: UsageSnapshot | null = null
```

Add a new function near `refresh`:

```ts
async function refreshUsage(root: HTMLElement): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const request: GetUsageRequest = { type: 'GET_USAGE' }
    const response = await chrome.tabs.sendMessage<GetUsageRequest, GetUsageResponse>(tab.id, request)
    if (response.ok) {
      usage = response.usage
      if (view.mode === 'list') await refresh(root)
    }
  } catch (error) {
    console.error('[Claude Tools] failed to fetch usage', error)
    // Supplementary data only — leave `usage` as its last-known value, no error surfaced.
  }
}
```

Update the call to `renderApp` inside `refresh` to pass `usage` before `context`:

```ts
    renderApp(root, buttons, view, runState, settingsState, usage, {
```

(This is the same call already at the top of `refresh` — only the argument list changes, the object literal that follows is unchanged.)

In the `onRun` handler, after the `if (response.ok) { ... } else { ... }` block (i.e. right after both branches have set `runState`, before the existing `if (view.mode === 'list') await refresh(root)` on the line that follows them), add:

```ts
          void refreshUsage(root)
```

At the very bottom of the file, change:

```ts
void refresh(root)
```

to:

```ts
void refresh(root)
void refreshUsage(root)
```

- [ ] **Step 6: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: existing tests pass; build succeeds. (`renderApp`'s new parameter will cause a type error if any call site wasn't updated — there is exactly one call site, in `main.ts`, updated in Step 5.)

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/UsageCard.ts src/sidepanel/render.ts src/sidepanel/main.ts src/sidepanel/style.css
git commit -m "feat: show a usage card in the sidebar, fed by claude.ai's usage endpoint"
```

---

### Task 4: Collapsed rail mode

**Files:**
- Create: `src/shared/preferences.ts`
- Create: `src/sidepanel/CollapsedRail.ts`
- Modify: `src/sidepanel/render.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/sidepanel/style.css`

**Interfaces:**
- Consumes: `UsageSnapshot` (Task 1), `Button`/`ButtonType` (`src/shared/types.ts`), `RunState` (`src/sidepanel/render.ts`).
- Produces: `getSidebarCollapsed(): Promise<boolean>`, `setSidebarCollapsed(collapsed: boolean): Promise<void>` (`src/shared/preferences.ts`); `renderCollapsedRail(...): HTMLElement` (`src/sidepanel/CollapsedRail.ts`).

This task is manual-verification-only (DOM rendering, `chrome.storage.local`, same as every prior sidepanel UI task).

- [ ] **Step 1: Write the storage preference helper**

Create `src/shared/preferences.ts`:

```ts
const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed'

export async function getSidebarCollapsed(): Promise<boolean> {
  const stored = await chrome.storage.local.get(SIDEBAR_COLLAPSED_KEY)
  return stored[SIDEBAR_COLLAPSED_KEY] === true
}

export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  await chrome.storage.local.set({ [SIDEBAR_COLLAPSED_KEY]: collapsed })
}
```

- [ ] **Step 2: Add collapsed-rail CSS**

In `src/sidepanel/style.css`, append at the end of the file:

```css
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 2px 0 4px;
}

.rail-icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--surface-input);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
  cursor: pointer;
}

.rail-icon-btn:hover {
  background: var(--surface-hover);
}

.rail-rings {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.ring {
  position: relative;
  width: 40px;
  height: 40px;
}

.ring svg {
  width: 40px;
  height: 40px;
  transform: rotate(-90deg);
}

.ring circle {
  fill: none;
  stroke-width: 4;
}

.ring .track {
  stroke: var(--surface-hover);
}

.ring .fill {
  stroke-linecap: round;
}

.ring .fill.normal {
  stroke: var(--success);
}

.ring .fill.warning {
  stroke: var(--warning);
}

.ring .fill.critical {
  stroke: var(--danger);
}

.ring .pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.rail-expand {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  background: var(--accent-solid);
  color: var(--accent-text-on);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
  cursor: pointer;
}

.rail-expand:hover {
  background: var(--accent-solid-hover);
}

.rail-divider {
  width: 32px;
  height: 1px;
  background: var(--border);
}

.rail-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.rail-btn-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--surface-card);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
}

.rail-btn-icon:hover:not(:disabled) {
  background: var(--surface-hover);
}

.rail-btn-icon:disabled {
  opacity: 0.5;
  cursor: default;
}

.rail-skill-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--surface-canvas);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rail-spacer {
  flex: 1;
}

.rail-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--surface-hover);
  color: var(--text-muted);
  border: 1px dashed var(--border);
  flex-shrink: 0;
}
```

- [ ] **Step 3: Write `CollapsedRail.ts`**

Create `src/sidepanel/CollapsedRail.ts`:

```ts
import type { Button } from '../shared/types'
import type { UsageSnapshot } from '../shared/usage'
import type { RunState } from './render'
import { severityClass } from './UsageCard'

export interface CollapsedRailContext {
  onToggleCollapse: () => void
  onRefreshUsage: () => void
  onRun: (button: Button) => void
}

const RING_RADIUS = 16
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const SVG_NS = 'http://www.w3.org/2000/svg'

function renderRing(percent: number, severity: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'ring'

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 40 40')

  const track = document.createElementNS(SVG_NS, 'circle')
  track.setAttribute('class', 'track')
  track.setAttribute('cx', '20')
  track.setAttribute('cy', '20')
  track.setAttribute('r', String(RING_RADIUS))
  svg.appendChild(track)

  const clamped = Math.min(100, Math.max(0, percent))
  const offset = RING_CIRCUMFERENCE - (clamped / 100) * RING_CIRCUMFERENCE
  const fill = document.createElementNS(SVG_NS, 'circle')
  fill.setAttribute('class', `fill ${severityClass(severity)}`)
  fill.setAttribute('cx', '20')
  fill.setAttribute('cy', '20')
  fill.setAttribute('r', String(RING_RADIUS))
  fill.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE))
  fill.setAttribute('stroke-dashoffset', String(offset))
  svg.appendChild(fill)

  wrap.appendChild(svg)

  const pct = document.createElement('span')
  pct.className = 'pct'
  pct.textContent = `${Math.round(clamped)}%`
  wrap.appendChild(pct)

  return wrap
}

export function renderCollapsedRail(
  buttons: Button[],
  usage: UsageSnapshot | null,
  runState: Map<string, RunState>,
  context: CollapsedRailContext,
): HTMLElement {
  const rail = document.createElement('div')
  rail.className = 'rail'

  const refreshButton = document.createElement('button')
  refreshButton.type = 'button'
  refreshButton.className = 'rail-icon-btn'
  refreshButton.textContent = '↻'
  refreshButton.setAttribute('aria-label', 'Refresh usage')
  refreshButton.addEventListener('click', context.onRefreshUsage)
  rail.appendChild(refreshButton)

  if (usage && usage.meters.length > 0) {
    const rings = document.createElement('div')
    rings.className = 'rail-rings'
    usage.meters.forEach((meter) => {
      rings.appendChild(renderRing(meter.percent, meter.severity))
    })
    rail.appendChild(rings)
  }

  const expandButton = document.createElement('button')
  expandButton.type = 'button'
  expandButton.className = 'rail-expand'
  expandButton.textContent = '→'
  expandButton.setAttribute('aria-label', 'Expand sidebar')
  expandButton.addEventListener('click', context.onToggleCollapse)
  rail.appendChild(expandButton)

  if (buttons.length > 0) {
    const divider = document.createElement('div')
    divider.className = 'rail-divider'
    rail.appendChild(divider)

    const buttonList = document.createElement('div')
    buttonList.className = 'rail-buttons'
    buttons.forEach((button) => {
      const icon = document.createElement('button')
      icon.type = 'button'
      icon.className = 'rail-btn-icon'
      icon.textContent = button.name.trim().charAt(0).toUpperCase() || '?'
      icon.title = button.name
      icon.disabled = runState.get(button.id)?.isRunning ?? false
      icon.setAttribute('aria-label', `Run ${button.name}`)
      icon.addEventListener('click', () => context.onRun(button))
      if (button.type === 'skill') {
        const dot = document.createElement('span')
        dot.className = 'rail-skill-dot'
        dot.textContent = '/'
        dot.setAttribute('aria-hidden', 'true')
        icon.appendChild(dot)
      }
      buttonList.appendChild(icon)
    })
    rail.appendChild(buttonList)
  }

  const spacer = document.createElement('div')
  spacer.className = 'rail-spacer'
  rail.appendChild(spacer)

  const avatar = document.createElement('div')
  avatar.className = 'rail-avatar'
  avatar.title = 'Account (coming in a later phase)'
  avatar.setAttribute('aria-hidden', 'true')
  rail.appendChild(avatar)

  return rail
}
```

- [ ] **Step 4: Wire the toggle button and collapsed branch into `render.ts`**

In `src/sidepanel/render.ts`, add to the imports:

```ts
import { renderCollapsedRail } from './CollapsedRail'
```

Add two new callbacks to the `RenderContext` interface:

```ts
  onToggleCollapse: () => void
  onRefreshUsage: () => void
```

Change the `renderApp` signature again, adding `collapsed` after `usage`:

```ts
export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  usage: UsageSnapshot | null,
  collapsed: boolean,
  context: RenderContext,
): void {
```

Immediately after the existing `if (view.mode === 'settings') { ... return }` block, and before the `const header = document.createElement('div')` line, add:

```ts
  if (collapsed) {
    root.appendChild(
      renderCollapsedRail(buttons, usage, runState, {
        onToggleCollapse: context.onToggleCollapse,
        onRefreshUsage: context.onRefreshUsage,
        onRun: context.onRun,
      }),
    )
    return
  }
```

In the existing toolbar-building code, right after `header.className = 'toolbar'` and before the `settingsButton` is created, add a collapse toggle button:

```ts
  const collapseButton = document.createElement('button')
  collapseButton.type = 'button'
  collapseButton.className = 'icon-button'
  collapseButton.textContent = '⇤'
  collapseButton.setAttribute('aria-label', 'Collapse sidebar')
  collapseButton.addEventListener('click', context.onToggleCollapse)
  header.appendChild(collapseButton)
```

- [ ] **Step 5: Wire it up in `main.ts`**

In `src/sidepanel/main.ts`, add to the imports:

```ts
import { getSidebarCollapsed, setSidebarCollapsed } from '../shared/preferences'
```

Add a module-level variable near `let usage: UsageSnapshot | null = null`:

```ts
let collapsed = false
```

Update the call to `renderApp` inside `refresh` to pass `collapsed` after `usage`:

```ts
    renderApp(root, buttons, view, runState, settingsState, usage, collapsed, {
```

Add two new handlers to the object passed to `renderApp`, alongside the existing ones (e.g. right after `onSettingsBack`):

```ts
      onToggleCollapse: () => {
        collapsed = !collapsed
        void setSidebarCollapsed(collapsed)
        void refresh(root)
      },
      onRefreshUsage: () => {
        void refreshUsage(root)
      },
```

At the bottom of the file, change:

```ts
void refresh(root)
void refreshUsage(root)
```

to:

```ts
async function start(): Promise<void> {
  collapsed = await getSidebarCollapsed()
  await refresh(root)
  void refreshUsage(root)
}

void start()
```

- [ ] **Step 6: Verify no regressions**

Run: `pnpm test && pnpm run build`
Expected: existing tests pass; build succeeds with no type errors (the `renderApp` signature change must match its one call site, updated in Step 5).

- [ ] **Step 7: Commit**

```bash
git add src/shared/preferences.ts src/sidepanel/CollapsedRail.ts src/sidepanel/render.ts src/sidepanel/main.ts src/sidepanel/style.css
git commit -m "feat: add a manually-toggled collapsed icon-rail sidebar mode"
```
