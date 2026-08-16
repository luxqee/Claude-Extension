# Claude Browser Extension — Stage 1E Design: UX / Polish

Date: 2026-08-16
Status: Approved

## Context

Stages 1B, 1C, and 1D are complete and merged: the extension has a working
side panel with full button CRUD, up/down reorder, and click-to-insert
(Stage 1D was corrected after this design was drafted to insert-only,
never auto-send — see the "Insert-only" note below, already shipped
separately from this stage). This document covers the remaining Stage 1E
scope from the original product spec: several items on that list
(empty states, error states, loading states, delete confirmation) were
already built incidentally by earlier stages and are not revisited here.
The real remaining scope is: hover states, drag-and-drop reorder,
keyboard accessibility, visual/typographic polish, responsive behavior,
and a settings surface (export/import).

**Insert-only note:** clicking a button's name now types its prompt into
Claude's chat box and stops — the user reviews and sends it themselves.
This shipped as a direct fix before this stage (commit `e3b0d08`) and is
not part of this design; mentioned here only so the UI copy/interaction
descriptions below are read against the current, correct behavior.

## Decisions

- **Drag-and-drop replaces the up/down arrow buttons**, implemented with
  native HTML5 drag events (`dragstart`/`dragover`/`drop`) on a dedicated
  drag handle per row (not the whole row, so it doesn't compete with the
  row's own click-to-run target). A drop-line indicator shows where the
  dragged row will land. This is a desktop-only interaction — native HTML5
  drag-and-drop has no touch equivalent, and Chrome extensions are a
  desktop surface, so no touch fallback is built.
- **Keyboard reorder:** the drag handle is a focusable, keyboard-operable
  control. With it focused, ArrowUp/ArrowDown moves that row up/down —
  the same operation dragging performs, so removing the visible arrow
  buttons doesn't remove keyboard-only reorder capability.
- **Focus-visible styling:** every interactive element (buttons, the drag
  handle, form fields) gets an explicit `:focus-visible` outline. Today
  these rely on invisible/faint browser defaults in the dark theme — the
  same class of bug as the earlier dark-mode text-contrast fix, just for
  focus rings instead of text.
- **Status line is announced:** the row's `Running…`/error status text
  gets `aria-live="polite"` so screen readers announce state changes
  without requiring focus to move there.
- **Visual hierarchy refinement, not a redesign:** primary actions (Add
  tool, Save) stay filled/orange; secondary actions (Edit, Cancel, the new
  drag handle) become outline/ghost style, visually distinct from primary;
  destructive (Delete) stays red text; the row name — the primary
  click-to-run target — gets slightly more visual weight. A consistent
  spacing scale is applied throughout. No new visual language is
  introduced; existing colors/radii/fonts are refined, not replaced.
- **Responsive:** Chrome's side panel is already natively resizable by the
  browser; this stage's responsibility is only ensuring the CSS holds up
  across that resizable range — row controls must not wrap awkwardly at
  narrow widths, and name truncation (already ellipsis-based) must keep
  working.
- **Settings — export/import:** a small settings area (a gear icon in the
  toolbar, opening a lightweight panel) with two actions: **Export**
  (serializes the current button list to a `.json` file and downloads it)
  and **Import** (reads a user-selected `.json` file, validates its shape,
  and adds its buttons to the existing list — never replaces). This
  directly serves the product's own stated use case of sharing tools with
  teammates or importing ones found elsewhere, and doubles as a manual
  backup mechanism ahead of Stage 2's real sync.
- **Import is additive, never destructive:** imported buttons get freshly
  generated ids (to avoid colliding with existing ones) and are appended
  after the current list, continuing the `order` sequence. A malformed or
  unreadable file shows an inline error and changes nothing — storage is
  never touched until the import file has been fully validated.

## Components

- **`src/sidepanel/style.css`** (modify) — hover states on all interactive
  elements, `:focus-visible` outlines, drop-line indicator styling,
  refined spacing/hierarchy tokens, drag-handle styling, settings-panel
  styling. No new file; this stage is primarily a CSS pass plus the pieces
  below.
- **`src/sidepanel/ButtonRow.ts`** (modify) — adds a drag-handle element
  per row (`draggable="true"`, keyboard-focusable, ArrowUp/ArrowDown
  handling), removes the up/down icon buttons, adds `aria-live="polite"`
  to the status line.
- **`src/sidepanel/render.ts`** / **`src/sidepanel/main.ts`** (modify) —
  `onMoveUp`/`onMoveDown` are replaced by a single `onReorder(orderedIds: string[])`
  callback that both the drag-drop flow and the keyboard-arrow flow call,
  wrapping the same `toolService.reorderButtons` call the old handlers
  used.
- **`src/shared/backup.ts`** (new) — pure functions with no DOM
  dependency: `serializeButtons(buttons: Button[]): string` (JSON
  stringify) and `parseImportedButtons(json: string, existing: Button[]): Button[]`
  (validates shape, generates fresh ids, computes continuing `order`
  values, returns the buttons to add — throws a descriptive error on
  invalid input, caught and surfaced by the UI layer). This is the one
  place this stage introduces genuinely unit-testable logic beyond CSS.
- **`src/sidepanel/SettingsPanel.ts`** (new) — renders the gear-icon
  trigger and the export/import panel; wires file download (Export) and
  a hidden `<input type="file">` (Import) to `backup.ts`'s functions and
  `ToolService`.

## Data Flow

**Drag-and-drop / keyboard reorder:** user drags a row (or focuses its
handle and presses an arrow key) → the row list computes a new ordered
id array → `onReorder(orderedIds)` in `main.ts` calls
`toolService.reorderButtons(orderedIds)` → `refresh()` re-renders.

**Export:** user clicks Export → `serializeButtons(currentButtons)` →
browser download of the resulting JSON.

**Import:** user selects a file → its text is read → `parseImportedButtons(json, currentButtons)`
→ on success, each returned button is persisted via
`toolService.createButton`-equivalent storage write, then `refresh()`;
on failure, an inline error appears in the settings panel and nothing is
written.

## Error Handling

Import failures (malformed JSON, wrong shape, empty file) are caught
before any storage write and shown as a specific inline message in the
settings panel, consistent with the project's existing no-silent-failure
convention. Drag-and-drop has no failure mode of its own beyond the
existing `reorderButtons` error path, already handled.

## Testing

- `backup.ts`'s `serializeButtons`/`parseImportedButtons` are pure
  functions with no DOM dependency — real unit tests with Vitest,
  covering valid input, malformed JSON, wrong shape, and id-collision
  avoidance on import.
- Drag-and-drop, keyboard-arrow reorder, focus-visible styling, hover
  states, and the settings panel's DOM wiring are manual-verification-only,
  consistent with every other UI file in this project (no jsdom
  dependency is introduced).
