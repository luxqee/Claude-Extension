# Claude Browser Extension — Stage 1D Design: Claude Prompt Execution

Date: 2026-08-16
Status: Approved

## Context

Stage 1B and 1C are complete and merged: the extension has a working side
panel with full button CRUD/reorder, backed by `ToolService` /
`StorageAdapter` / `ChromeLocalStorageAdapter`. The content script
(`src/content/content-script.ts`) currently only stubs an `INSERT_AND_SEND`
message listener that replies `not_implemented`. `ButtonRow.ts` has no
"run this button" affordance — clicking a row does nothing.

This document covers Stage 1D only: making a button click actually insert
its prompt into Claude's chat input and send it. Real DOM selectors for
Claude's chat input and send button were already captured from live
claude.ai markup during Stage 1A/1B brainstorming — see
`docs/superpowers/specs/2026-08-16-stage1-architecture-design.md`'s
"Confirmed Claude DOM Selectors" section, which this document builds on
rather than repeating.

## Decisions

- **Run trigger:** clicking a button row's name/label runs it. Edit,
  Delete, and the reorder arrows remain small icon controls off to the
  side, unambiguously secondary. No separate "Run" icon.
- **Wrong-tab handling:** if the active tab isn't claude.ai when a button
  is clicked, show an inline error ("Open claude.ai to use this tool") and
  do nothing else — no auto-opening or focusing a different tab. This
  avoids the `tabs` permission the project has deliberately not requested,
  and matches the side panel already being scoped to claude.ai tabs since
  Stage 1B.
- **Insertion technique:** `document.execCommand('insertText', false, prompt)`
  after focusing the input, over constructing a synthetic
  `ClipboardEvent`/`DataTransfer` paste. `execCommand` fires real
  `beforeinput`/`input` events that ProseMirror's own input handling
  processes, keeping its internal editor state in sync with the DOM. It is
  simpler to implement correctly than a hand-built paste event, at the cost
  of being a deprecated API — acceptable since it is exactly the kind of
  legacy API extensions rely on for this, and Chromium continues to support
  it broadly.
- **Retry window:** poll for the chat input every ~150ms for up to 3
  seconds before reporting "not found." Long enough to cover a normal
  claude.ai page load; short enough that a genuine failure (e.g. Claude
  changed its markup and the selector no longer matches) surfaces quickly
  rather than leaving a row stuck.
- **Loading state:** the clicked row dims/disables itself while a run is
  in progress (up to the 3s poll window plus a short send-confirmation
  poll). Prevents double-clicks from firing the same prompt twice, and
  gives clear feedback that something is happening. Reverts to normal on
  success or failure.
- **Error feedback:** inline status text scoped to the clicked row,
  auto-clearing on the next action taken anywhere in the panel. Not a
  whole-panel banner — keeps failures localized to the row that caused
  them, consistent with the project's existing per-boundary error-display
  pattern (`root.textContent` on catastrophic failures, scoped messaging
  everywhere else).
- **Shared message contract:** `src/shared/messages.ts` (new) defines the
  `INSERT_AND_SEND` request/response shape once. Both `main.ts` (sender)
  and `content-script.ts` (receiver) import from it, closing a gap the
  Stage 1B/1C final review flagged — without it, the two sides' message
  shapes could silently drift apart as either side changes.

## Components

- **`src/shared/messages.ts`** — the message contract:
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
- **`src/content/claude-adapter.ts`** (new) — all Claude-specific DOM
  logic, isolated to this one file. Exposes
  `insertAndSend(prompt: string): Promise<InsertAndSendResponse>`:
  1. Poll `document.querySelector('[data-testid="chat-input"]')` every
     ~150ms for up to 3s. Not found within that window →
     `{ ok: false, error: 'input_not_found', message: "Couldn't find Claude's chat box. Try reloading the page." }`.
  2. Focus the input, call
     `document.execCommand('insertText', false, prompt)`.
  3. Poll briefly (short window, well under a second) for
     `document.querySelector('button[aria-label="Send message"]')` to
     exist and be genuinely enabled — checking the real `disabled`
     property / `aria-disabled` attribute, never the tooltip library's
     `data-trigger-disabled`, which is a false signal unrelated to whether
     the button actually works (confirmed during selector capture).
  4. If a usable send button is found, click it. If not, dispatch an
     Enter `keydown` followed by `keyup` on the focused input as a
     fallback (the input's `enterkeyhint="enter"` attribute is the
     evidence this submits).
  5. Briefly poll for the input to go empty again (Claude clears the
     composer on send) as a lightweight send-confirmation signal. If it
     doesn't clear within that window →
     `{ ok: false, error: 'send_failed', message: "Inserted the prompt but couldn't confirm it sent. Check the Claude tab." }`.
     Otherwise → `{ ok: true }`.
- **`src/content/content-script.ts`** (modify) — the `INSERT_AND_SEND`
  listener replaces its `not_implemented` stub with a real call into
  `claude-adapter.ts`, wrapped so any unexpected throw still resolves a
  `{ ok: false, ... }` response rather than leaving the sender hanging.
- **`src/sidepanel/ButtonRow.ts`** (modify) — the name element becomes an
  interactive control (clickable, keyboard-activatable) that invokes a new
  `onRun` callback. Row rendering gains two new pieces of state passed in
  by the caller: `isRunning` (dims/disables the row) and `runError`
  (renders the inline message beneath the row, if present).
- **`src/sidepanel/main.ts`** (modify) — new `onRun(button)` handler:
  resolves the active tab via `chrome.tabs.query({ active: true, currentWindow: true })`;
  if `tab.url` is empty (meaning it isn't a claude.ai tab, since
  `host_permissions` only populates `url` for matching tabs — this needs
  no `tabs` permission), sets that row's `runError` to
  `"Open claude.ai to use this tool."` and stops. Otherwise sets
  `isRunning` for that row, sends the `INSERT_AND_SEND` message via
  `chrome.tabs.sendMessage`, and on rejection (e.g. "receiving end does
  not exist" because the tab predates the extension's install/reload) sets
  `runError` to `"Reload the Claude tab and try again."`. On a resolved
  response, clears `isRunning` and sets `runError` from the response if
  `ok: false`, or clears it on success.

## Data Flow

1. User clicks a button row's name.
2. `main.ts`'s `onRun` resolves the active tab; bails out inline if it
   isn't a claude.ai tab.
3. Row enters `isRunning` state; `chrome.tabs.sendMessage` delivers
   `{ type: 'INSERT_AND_SEND', prompt }` to the content script.
4. Content script calls `claude-adapter.insertAndSend(prompt)`, which
   drives the DOM as described above and resolves an
   `InsertAndSendResponse`.
5. `main.ts` receives the response (or a rejection), clears `isRunning`,
   and sets/clears the row's inline error accordingly.

## Error Handling

Every failure path has a specific, human-readable message surfaced inline
at the row, plus a `console.error`/`console.warn` in whichever context
detected it (content script or side panel) — no boundary fails silently,
consistent with the project-wide constraint established in Stage 1B/1C.

## Testing

- `messages.ts`'s types have no runtime logic to test directly, but any
  pure helper functions introduced alongside it (if the implementation
  plan finds it needs one) get unit tests as usual.
- `ButtonRow.ts`'s new `isRunning`/`runError` rendering states and the
  `onRun` callback wiring are unit-testable DOM-construction logic, same
  pattern as the existing Edit/Delete/reorder controls.
- `claude-adapter.ts`'s DOM-driving logic is not meaningfully unit-testable
  (it depends on live claude.ai markup) and is verified by manual testing
  against the real site, same as every other Claude-DOM-touching decision
  in this project.

## Stage 2 Note

Out of scope here, noted only for continuity: nothing in this design
changes the `StorageAdapter`/`ToolService` seam from Stage 1B/1C — running
a button reads its `prompt` via the same `ToolService.listButtons()` data
already in memory in the side panel; no new storage access is introduced.
