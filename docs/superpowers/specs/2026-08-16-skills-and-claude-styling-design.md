# Claude Browser Extension — Skill Buttons + Claude-Matched Styling Design

Date: 2026-08-16
Status: Approved

## Context

Stages 1B through 1E are complete and merged: the extension has a working
side panel with full button CRUD, drag-and-drop/keyboard reorder, a
settings panel with JSON export/import, click-to-insert into Claude's chat
box (insert-only, never auto-send), and a hover/focus-visible polish pass.

This document covers two additions requested together: (1) a distinct
"skill" button type, alongside the existing plain-text prompt buttons, and
(2) a typography and color pass that visually aligns the side panel with
claude.ai's own design system, using data captured directly from
claude.ai's live page during Stage 1A/1D's selector-gathering work.

## Decisions

### Skill buttons

- **Data model:** `Button` gains `type: 'prompt' | 'skill'`. The existing
  `prompt` field is reused unchanged to hold the exact text to insert
  either way — for a skill, that text is the slash-invocation itself (e.g.
  `/doc-summary`). No new insertion logic is needed: Stage 1D's
  `insertPrompt()` already types whatever text it's given into Claude's
  chat box and stops, which is exactly the right behavior for a skill
  invocation too — claude.ai's own composer has a native slash-command
  picker (confirmed present via the "Type / for skills" placeholder and a
  `data-skill-arg-hint-sr` element captured from the live page during
  Stage 1D), and it takes over from there exactly like a user typing `/`
  themselves would expect.
- **Migration:** existing stored buttons predate this field and have no
  `type` value. `ChromeLocalStorageAdapter`'s validation treats a missing
  `type` as `'prompt'` — today's only behavior — rather than rejecting the
  button as malformed. No data loss for anything already saved.
- **Create/edit UI:** the existing Add/Edit form gains a Prompt/Skill
  toggle at the top, defaulting to Prompt. Switching it only relabels the
  text field ("Prompt" → "Skill invocation", placeholder text changes to
  something like `/skill-name argument`) — the rest of the form and the
  save logic are unchanged.
- **Row display:** a small `/` badge renders before a skill button's name
  in the list, echoing claude.ai's own `/`-for-skills convention. Prompt
  buttons are visually unchanged.
- **Export/import:** `backup.ts`'s JSON shape gains `type` alongside
  `name`/`prompt`, so export/import and sharing with a teammate preserves
  whether an entry is a skill or a prompt. Importing an entry with no
  `type` field (e.g. a file exported before this change) defaults it to
  `'prompt'`, matching the storage-layer migration behavior.

### Claude-matched typography

- claude.ai's own UI typeface is a proprietary custom font ("anthropic-sans",
  served as versioned `.woff2` files from Anthropic's own asset host) — not
  a public or redistributable asset, so it is not bundled into this
  extension. What this design does use is claude.ai's own **documented
  fallback stack** for when that font isn't loaded, captured directly from
  their page CSS: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
  This is public information (a plain CSS property value, not an asset)
  and gets the side panel visually close to claude.ai's own type using
  only fonts already present on the user's machine — zero new assets, zero
  network dependency, consistent with every prior stage's "no new
  dependencies" constraint.
- A small, deliberate type scale replaces today's scattered ad-hoc sizes
  (13px/12px/15px used inconsistently across different rules with no
  clear logic): a defined body size, a heading size, and a muted/hint
  size, applied consistently.
- An explicit `line-height` is set on body text (currently unset, relying
  on the browser default, which reads cramped for the prompt textarea and
  longer hint/error text).

### Claude-matched colors

claude.ai's page CSS (captured during the same DOM inspection) defines its
color system as CSS custom properties with separate light/dark values. This
design adopts the same pattern — custom properties defined once in `:root`
and overridden inside `@media (prefers-color-scheme: dark)` — populated
with claude.ai's own resolved values, so every existing rule references a
token instead of a scattered hardcoded hex value, and light/dark switching
is centralized and correct (previously the panel had no explicit surface
colors at all, only inherited browser defaults, which is why this needs a
real token pass rather than one-off tweaks).

Resolved values taken directly from claude.ai's own tokens:

| Token | Light | Dark |
|---|---|---|
| `--surface-canvas` (page bg) | `#f9f9f7` | `#0b0b0b` |
| `--surface-card` (row/panel bg) | `#fcfcfb` | `#151515` |
| `--surface-input` (input/textarea bg) | `#fff` | `#20201f` |
| `--text-primary` | `#0b0b0b` | `#f0efec` |
| `--text-muted` | `#898781` | `#898781` |
| `--accent` (brand "clay") | `#d97757` | `#d97757` |

`#d97757` is claude.ai's actual brand accent color — this extension has
used that exact color for its own accent (buttons, focus outline) since
Stage 1B by independent choice, so no change is needed there; it's simply
now documented as intentionally matching rather than coincidental.

Delete/danger (`#b3261e`) and success (`#2e7d32`) colors are kept as they
are — claude.ai's own reds live behind CSS relative-color-syntax
expressions in HSL space in the captured data, not clean extractable hex
values, and matching them exactly isn't central to what's being asked for
here (a general Claude-like feel), so this design doesn't chase them.

Border colors (currently a flat `#d8d8d8` everywhere) become
`--border` / `--border-strong` tokens with light/dark-appropriate values,
following the same token pattern.

## Components

No new files for the color/typography work — `src/sidepanel/style.css` is
restructured to define the token set at the top and have every existing
rule reference tokens instead of hardcoded values, plus the font-stack and
type-scale changes described above.

For skill buttons:
- **`src/shared/types.ts`** (modify) — `Button` gains `type: 'prompt' | 'skill'`.
- **`src/shared/storage/chrome-local-adapter.ts`** (modify) — the stored-data
  validation/read path defaults a missing `type` to `'prompt'`.
- **`src/shared/tool-service.ts`** (modify) — `createButton`/`updateButton`
  accept and pass through `type`.
- **`src/shared/backup.ts`** (modify) — export includes `type`; import
  defaults a missing `type` to `'prompt'`, mirroring the storage-layer
  migration.
- **`src/sidepanel/EditForm.ts`** (modify) — adds the Prompt/Skill toggle.
- **`src/sidepanel/ButtonRow.ts`** (modify) — renders the `/` badge for
  skill-type buttons.

## Error Handling

Unchanged from the existing pattern — storage/import validation degrades
gracefully (missing `type` defaults rather than errors), consistent with
every prior stage's no-silent-failure, no-data-loss conventions.

## Testing

- The `type`-defaulting logic in `ChromeLocalStorageAdapter` and the
  export/import shape change in `backup.ts` are both pure and already
  covered by this project's existing TDD pattern — new test cases are
  added to the existing test files, not new test infrastructure.
- `EditForm.ts`/`ButtonRow.ts`'s toggle and badge rendering, and the full
  `style.css` pass, are manual-verification-only, consistent with every
  other UI file in this project.
