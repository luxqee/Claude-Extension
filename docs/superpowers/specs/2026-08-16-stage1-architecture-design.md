# Claude Browser Extension — Stage 1 Architecture Design

Date: 2026-08-16
Status: Approved

## Context

Repository is greenfield (no commits, no files at design time). This document
covers Stage 1 only: a fully local Chrome MV3 extension that adds a sidebar
of configurable buttons to claude.ai. Each button inserts a stored prompt
into Claude's chat input and sends it. No backend, accounts, or sync in
Stage 1 — see "Stage 2 seam" below for how this is expected to evolve.

## Decisions

- **Sidebar mechanism:** Chrome's native Side Panel API (`chrome.sidePanel`),
  not a content-script-injected overlay `<div>`. Native panel means the
  browser owns resizing/layout and the extension never touches Claude's page
  DOM/CSS for its own UI — eliminates a whole class of visual collision bugs.
  Trade-off accepted: the panel runs in a separate execution context from the
  page, so inserting text requires message-passing to a content script
  rather than direct DOM access from the panel itself.
- **Language/build tooling:** TypeScript + Vite + the CRXJS plugin. CRXJS
  handles MV3 manifest generation and correct bundling of the service
  worker/content script/side panel from one Vite config. TypeScript is
  chosen specifically because the Claude DOM-adapter code is the most
  failure-prone part of this project, and compile-time null/type checking
  catches a class of bugs that would otherwise surface as silent runtime
  failures on claude.ai.
- **Side panel UI:** Vanilla TypeScript with small DOM-rendering helpers, no
  UI framework (no Preact/React). The panel is a list of buttons plus two
  small forms (add/edit) — not enough UI complexity to justify a framework
  dependency, consistent with the "avoid unnecessary dependencies" rule in
  the product spec.
- **Claude DOM discovery:** Real selectors sourced from the user via
  DevTools inspection rather than guessed at, since this session has no live
  browser access to claude.ai. Until real selectors are supplied, the
  adapter ships with a stubbed lookup that logs a clear TODO error rather
  than silently no-op'ing.
- **Storage/service layering:** Full interface-based adapter now, not a
  lighter single-module approach. `StorageAdapter` interface with a
  `ChromeLocalStorageAdapter` implementation; `ToolService` depends only on
  the interface. This is deliberately over the minimum Stage 1 needs,
  because the product spec's explicit Stage 2 goal is swapping local storage
  for a backend API without rewriting UI or service code — the interface
  boundary is what makes that swap mechanical instead of a rewrite.

## Components

- **`src/background/service-worker.ts`** — MV3 service worker. Registers
  the side panel to open on `claude.ai` tabs via
  `chrome.sidePanel.setPanelBehavior`/`setOptions`. Relays messages between
  side panel and content script where direct messaging isn't possible.
- **`src/content/claude-adapter.ts`** — the single file that knows what
  Claude's DOM looks like. Exposes `insertAndSend(prompt: string): Promise<Result>`.
  Nothing else in the codebase references Claude-specific selectors.
- **`src/content/content-script.ts`** — thin message listener injected into
  `claude.ai/*`. Receives `INSERT_AND_SEND` messages, calls
  `claude-adapter`, replies with success/failure.
- **`src/sidepanel/`** — the UI: `main.ts` (entry), `render.ts` (renders
  button list from state), `ButtonRow.ts`, `EditForm.ts`, `style.css`.
  Talks only to `ToolService`, never to `chrome.storage` directly.
- **`src/shared/tool-service.ts`** — button CRUD + reorder operations. Sole
  dependency: `StorageAdapter`.
- **`src/shared/storage/storage-adapter.ts`** — interface:
  `getButtons()`, `saveButton(b)`, `deleteButton(id)`, `reorderButtons(ids)`.
- **`src/shared/storage/chrome-local-adapter.ts`** — `StorageAdapter`
  implementation backed by `chrome.storage.local`.
- **`src/shared/types.ts`** — `Button { id, name, order, prompt }`.

## Data Flow

1. User clicks a button in the side panel.
2. Side panel reads the button's prompt from `ToolService`.
3. Side panel sends `{ type: "INSERT_AND_SEND", prompt }` via
   `chrome.tabs.sendMessage` to the active `claude.ai` tab.
4. Content script's `claude-adapter` locates the input, sets its content,
   dispatches the events Claude's own input-handling code expects (so
   Claude's client-side state, not just the visible DOM, picks up the
   change), locates the send control, verifies it isn't disabled, and
   triggers send.
5. Content script replies success/failure. Side panel shows a toast on
   failure (e.g. "Couldn't find Claude's input — try reloading the page")
   instead of failing silently.

## Claude DOM Adapter Strategy

All claude.ai-specific selector logic is isolated to
`src/content/claude-adapter.ts` so that if Claude changes its markup, exactly
one file needs updating. Regardless of the specific selectors (pending real
markup from DevTools):

- Poll briefly for the input element if not immediately present (handles
  page still loading), rather than failing on first lookup.
- Prefer stability-ranked signals in this order: `contenteditable` +
  `role="textbox"`, `aria-label`, `data-testid`, over auto-generated CSS
  class names.
- Verify the send control is not `disabled` before triggering it.
- Emit a distinct, greppable console message per failure mode (input not
  found / send control not found / send control disabled) — no silent
  failures.

## Data Model

```
Button
├── id       (string, uuid)
├── name     (string)
├── order    (number)
└── prompt   (string)
```

Stored via `chrome.storage.local` (not `.sync` — avoids sync quota limits on
long prompts, and matches the "local only, no cloud sync" requirement).

## Manifest / Permissions

MV3. Permissions: `sidePanel`, `storage`, `scripting`. Host permissions and
content script matches limited to `https://claude.ai/*`. No `tabs`
permission, no broad host permissions, no analytics/telemetry.

## Error Handling

Every boundary — storage read/write, cross-context messaging, DOM lookup —
has an explicit failure path that surfaces to the console and, where
user-actionable, to the side panel UI. No boundary fails silently.

## Testing

- `ToolService` and `StorageAdapter` are unit-testable in isolation with
  Vitest, using a fake in-memory `StorageAdapter` for `ToolService` tests.
- `claude-adapter.ts` DOM logic is not meaningfully unit-testable (depends
  on live claude.ai markup); it is validated by manual testing against the
  real site per the Stage 1D/1F acceptance criteria. This is called out
  explicitly rather than faked with brittle DOM-mock tests.

## Stage 2 Seam

Stage 2 (organisation/backend) is expected to replace
`ChromeLocalStorageAdapter` with a `RemoteApiAdapter` implementing the same
`StorageAdapter` interface. `ToolService` and all UI code are not expected
to change. Auth/organisation concepts would layer above `ToolService`
(e.g. a session/identity check gating which adapter is constructed), not
inside it.

## Confirmed Claude DOM Selectors (2026-08-16)

Captured from live claude.ai markup via DevTools:

- **Chat input:** `[data-testid="chat-input"]` — a `contenteditable="true"`
  `div` with `role="textbox"`, `aria-label="Write your prompt to Claude"`,
  built on Tiptap/ProseMirror (`class="tiptap ProseMirror"`). Because it is
  a rich-text editor and not a `<textarea>`, insertion cannot be done by
  setting `.value` or `.textContent` directly — the adapter must dispatch a
  synthetic paste event (`ClipboardEvent` with a `DataTransfer` carrying
  `text/plain`) or use `document.execCommand('insertText', false, text)`
  after focusing, so ProseMirror's own input handling processes the change
  and its internal state stays in sync with the DOM.
- **Send button:** `button[aria-label="Send message"]` — no `data-testid`
  on this element, but the `aria-label` is stable, and structurally it is
  the only button in the composer's action bar with a brand/filled
  background (`bg-fill-brand`), i.e. the primary action.
- **Disabled check caveat:** a `data-trigger-disabled=""` attribute appears
  on this button and on unrelated composer buttons (model selector) — it is
  a tooltip-library artifact, not a real disabled signal. The adapter must
  check the actual `disabled` attribute / `aria-disabled="true"`, not
  `data-trigger-disabled`.
- **Enter-to-send fallback:** the input carries `enterkeyhint="enter"`,
  consistent with Enter (without Shift) submitting the message. If the send
  button cannot be located, the adapter falls back to dispatching an Enter
  `keydown`/`keyup` on the focused input rather than failing outright.

These selectors resolve the previously open item; `claude-adapter.ts` will
be implemented directly against them rather than shipped as a stub.
